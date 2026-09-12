import mongoose from 'mongoose';
import { AppError } from '../middleware/errorHandler.js';
import { recordActivity } from './activityLog.service.js';
import { recordAuditLog } from './auditLog.service.js';
import { round2 } from '../models/shared/money.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createPersonService({ Model, TransactionModel, refField, activityType, entityType, labels, PaymentModel, ReturnModel, PayoutModel }) {
  async function getTotals(personId) {
    const [result] = await TransactionModel.aggregate([
      { $match: { [refField]: new mongoose.Types.ObjectId(personId) } },
      {
        $group: {
          _id: null,
          total: { $sum: '$total' },
          paid: { $sum: '$paid' },
          count: { $sum: 1 },
          lastPurchase: { $max: '$date' },
        },
      },
    ]);
    const base = !result
      ? { total: 0, paid: 0, remaining: 0, count: 0, lastPurchase: null }
      : { total: result.total, paid: result.paid, remaining: result.total - result.paid, count: result.count, lastPurchase: result.lastPurchase };

    if (PaymentModel) {
      const [paymentResult] = await PaymentModel.aggregate([
        { $match: { [refField]: new mongoose.Types.ObjectId(personId) } },
        { $group: { _id: null, paid: { $sum: '$amount' } } },
      ]);
      const paymentsPaid = paymentResult?.paid || 0;
      base.paid += paymentsPaid;
      base.remaining -= paymentsPaid;
    }

    if (ReturnModel) {
      const [returnResult] = await ReturnModel.aggregate([
        { $match: { [refField]: new mongoose.Types.ObjectId(personId) } },
        { $group: { _id: null, returned: { $sum: '$totalReturnAmount' } } },
      ]);
      const returned = returnResult?.returned || 0;
      base.returned = returned;
      base.remaining -= returned;

      let paidOut = 0;
      if (PayoutModel) {
        const [payoutResult] = await PayoutModel.aggregate([
          { $match: { [refField]: new mongoose.Types.ObjectId(personId) } },
          { $group: { _id: null, paidOut: { $sum: '$amount' } } },
        ]);
        paidOut = payoutResult?.paidOut || 0;
        base.paidOut = paidOut;
        base.remaining += paidOut;
      }

      base.creditOwed = base.remaining < 0 ? round2(-base.remaining) : 0;
      base.remaining = base.remaining < 0 ? 0 : round2(base.remaining);
    }

    return base;
  }

  async function list({ page = 1, limit = DEFAULT_PAGE_SIZE, search } = {}) {
    const match = {};
    if (search && search.trim()) {
      const re = new RegExp(escapeRegex(search.trim()), 'i');
      match.$or = [{ name: re }, { phone: re }];
    }

    const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
    const skip = (pageNum - 1) * pageSize;

    const itemsPipeline = [
      { $skip: skip },
      { $limit: pageSize },
      {
        $lookup: {
          from: TransactionModel.collection.name,
          localField: '_id',
          foreignField: refField,
          as: '_tx',
        },
      },
      {
        $addFields: {
          totals: {
            total: { $sum: '$_tx.total' },
            paid: { $sum: '$_tx.paid' },
            count: { $size: '$_tx' },
            lastPurchase: { $max: '$_tx.date' },
          },
        },
      },
    ];

    if (PaymentModel) {
      itemsPipeline.push(
        {
          $lookup: {
            from: PaymentModel.collection.name,
            localField: '_id',
            foreignField: refField,
            as: '_payments',
          },
        },
        { $addFields: { 'totals.paid': { $add: ['$totals.paid', { $sum: '$_payments.amount' }] } } },
      );
    }

    if (ReturnModel) {
      itemsPipeline.push(
        {
          $lookup: {
            from: ReturnModel.collection.name,
            localField: '_id',
            foreignField: refField,
            as: '_returns',
          },
        },
        { $addFields: { 'totals.returned': { $sum: '$_returns.totalReturnAmount' } } },
      );
    }

    if (ReturnModel && PayoutModel) {
      itemsPipeline.push(
        {
          $lookup: {
            from: PayoutModel.collection.name,
            localField: '_id',
            foreignField: refField,
            as: '_payouts',
          },
        },
        { $addFields: { 'totals.paidOut': { $sum: '$_payouts.amount' } } },
      );
    }

    const excludeProjection = { _tx: 0 };
    if (PaymentModel) excludeProjection._payments = 0;
    if (ReturnModel) excludeProjection._returns = 0;
    if (ReturnModel && PayoutModel) excludeProjection._payouts = 0;

    itemsPipeline.push(
      {
        $addFields: {
          'totals.remaining': ReturnModel
            ? {
              $add: [
                { $subtract: [{ $subtract: ['$totals.total', '$totals.paid'] }, '$totals.returned'] },
                PayoutModel ? '$totals.paidOut' : 0,
              ],
            }
            : { $subtract: ['$totals.total', '$totals.paid'] },
        },
      },
    );

    if (ReturnModel) {
      itemsPipeline.push({
        $addFields: {
          'totals.creditOwed': { $cond: [{ $lt: ['$totals.remaining', 0] }, { $multiply: ['$totals.remaining', -1] }, 0] },
          'totals.remaining': { $cond: [{ $lt: ['$totals.remaining', 0] }, 0, '$totals.remaining'] },
        },
      });
    }

    itemsPipeline.push({ $project: excludeProjection });

    const [{ items, totalCount }] = await Model.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $facet: { items: itemsPipeline, totalCount: [{ $count: 'count' }] } },
    ]);

    const total = totalCount[0]?.count || 0;
    return {
      items,
      pagination: { page: pageNum, limit: pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async function getOne(id) {
    const person = await Model.findById(id);
    if (!person) throw new AppError(labels.notFound, 404);
    const totals = await getTotals(id);
    const plain = typeof person.toObject === 'function' ? person.toObject() : person;
    return { ...plain, totals };
  }

  async function findDuplicates({ name, phone }) {
    const or = [];
    if (name && name.trim()) {
      or.push({ name: new RegExp(`^${escapeRegex(name.trim())}$`, 'i') });
    }
    if (phone && phone.trim()) {
      or.push({ phone: phone.trim() });
    }
    if (!or.length) return [];
    return Model.find({ $or: or }).limit(5).select('name phone address').lean();
  }

  async function create(data, { allowDuplicate = false } = {}) {
    if (!allowDuplicate) {
      const duplicates = await findDuplicates(data);
      if (duplicates.length) {
        throw new AppError(
          'يوجد سجل بنفس الاسم أو رقم الهاتف بالفعل',
          409,
          { code: 'POSSIBLE_DUPLICATE', matches: duplicates },
        );
      }
    }

    const person = await Model.create(data);
    await recordActivity({ type: activityType, description: `${labels.added}: ${person.name}`, refId: person._id });
    await recordAuditLog({
      action: `${activityType}.create`,
      entityType,
      entityId: person._id,
      values: { name: person.name, phone: person.phone, address: person.address },
    });
    return person;
  }

  async function update(id, data) {
    const person = await Model.findById(id);
    if (!person) throw new AppError(labels.notFound, 404);

    const changedKeys = Object.keys(data);
    const before = {};
    for (const key of changedKeys) before[key] = person[key];

    Object.assign(person, data);
    await person.save();

    const after = {};
    for (const key of changedKeys) after[key] = person[key];

    await recordActivity({ type: activityType, description: `${labels.updated}: ${person.name}`, refId: person._id });
    await recordAuditLog({
      action: `${activityType}.update`,
      entityType,
      entityId: person._id,
      values: { changed: changedKeys, before, after },
    });
    return person;
  }

  async function remove(id) {
    const hasTransactions = await TransactionModel.exists({ [refField]: id });
    if (hasTransactions) throw new AppError(labels.deleteBlocked, 409, { code: 'HAS_TRANSACTIONS' });

    if (PaymentModel) {
      const hasPayments = await PaymentModel.exists({ [refField]: id });
      if (hasPayments) throw new AppError(labels.deleteBlocked, 409, { code: 'HAS_TRANSACTIONS' });
    }

    const person = await Model.findById(id);
    if (!person) throw new AppError(labels.notFound, 404);

    await Model.deleteOne({ _id: id });
    await recordActivity({ type: activityType, description: `${labels.deleted}: ${person.name}` });
    await recordAuditLog({
      action: `${activityType}.delete`,
      entityType,
      entityId: person._id,
      values: { name: person.name },
    });
    return { success: true };
  }

  return { list, getOne, create, update, remove, getTotals };
}

export default createPersonService;
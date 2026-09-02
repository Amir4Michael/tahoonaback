import mongoose from 'mongoose';
import { AppError } from '../middleware/errorHandler.js';
import { recordActivity } from './activityLog.service.js';
import { recordAuditLog } from './auditLog.service.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Customer and Supplier are structurally identical: name/phone/address,
 * blocked deletion when they have transactions on file, name-or-phone
 * substring search, and totals rolled up from a related transaction
 * collection (Sale for customers, Purchase for suppliers). Rather than
 * duplicate the same CRUD + aggregation logic twice with different field
 * names, this factory takes the handful of things that actually differ.
 *
 * `getTotals` mirrors the frontend's `customerTotals`/`supplierTotals`
 * selectors exactly: `{ total, paid, remaining, count, lastPurchase }`.
 */
export function createPersonService({ Model, TransactionModel, refField, activityType, entityType, labels }) {
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
    if (!result) return { total: 0, paid: 0, remaining: 0, count: 0, lastPurchase: null };
    return {
      total: result.total,
      paid: result.paid,
      remaining: result.total - result.paid,
      count: result.count,
      lastPurchase: result.lastPurchase,
    };
  }

  /**
   * One aggregation ($lookup + $facet) per request — totals are computed only
   * for the current page of results (bounded work), and the page of items
   * plus the total count for pagination come back in a single round-trip.
   */
  async function list({ page = 1, limit = DEFAULT_PAGE_SIZE, search } = {}) {
    const match = {};
    if (search && search.trim()) {
      const re = new RegExp(escapeRegex(search.trim()), 'i');
      match.$or = [{ name: re }, { phone: re }];
    }

    const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
    const skip = (pageNum - 1) * pageSize;

    const [{ items, totalCount }] = await Model.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          items: [
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
            { $addFields: { 'totals.remaining': { $subtract: ['$totals.total', '$totals.paid'] } } },
            { $project: { _tx: 0 } },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
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

  async function create(data) {
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

  /**
   * Checks for existing transactions BEFORE checking the person exists —
   * matching the frontend's exact check order in delete{Customer,Supplier}Svc.
   */
  async function remove(id) {
    const hasTransactions = await TransactionModel.exists({ [refField]: id });
    if (hasTransactions) throw new AppError(labels.deleteBlocked, 409, { code: 'HAS_TRANSACTIONS' });

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

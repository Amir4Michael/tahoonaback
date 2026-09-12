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
 *
 * `PaymentModel` is OPTIONAL and currently only passed for Customer (see
 * customer.service.js) — standalone settlements (CustomerPayment) that
 * reduce a customer's running balance without being tied to any single
 * Sale. When provided, every payment for a person is folded into `paid`/
 * `remaining` here, in ONE place, so `list`, `getOne`, and `getTotals` can
 * never drift out of sync with each other (a duplicated aggregation in each
 * call site risks exactly that). Supplier never passes this, so its
 * behavior — pipeline shape, values, everything — is byte-for-byte
 * unchanged from before this parameter existed.
 *
 * `ReturnModel` is the same idea for standalone SalesReturn documents —
 * folded into `remaining` ONLY (never `paid`, which stays actual cash
 * received), and `total` is left showing the raw gross sales sum on
 * purpose: a return reduces what the customer effectively owes without
 * rewriting the historical "total sold" figure.
 *
 * A return is NEVER rejected for exceeding what the person owed (return
 * eligibility is quantity-based only — see salesReturn.service.js /
 * purchaseReturn.service.js), so this subtraction can legitimately go
 * negative (e.g. a fully-paid customer returns goods). `remaining` is
 * floored at 0 (matches every money field's own `min: 0` in this project —
 * nothing here has ever displayed a negative amount owed), and the excess
 * is surfaced separately as `creditOwed`: money the shop owes BACK to this
 * person. This is a transparent, read-only figure only — not a stored,
 * spendable, or redeemable balance (the system has no such concept, and
 * this does not invent one); it does not touch the cashbox by itself. See
 * services/customerBalance.service.js / supplierBalance.service.js for the
 * exact same formula used inside a transaction when validating a new
 * payment/return.
 */
export function createPersonService({ Model, TransactionModel, refField, activityType, entityType, labels, PaymentModel, ReturnModel }) {
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
      // Floor at 0 + surface any excess as creditOwed — see the doc block
      // above. Only relevant once ReturnModel exists, since neither Sale/
      // Purchase (bounded per-transaction) nor CustomerPayment/SupplierPayment
      // (already rejected past the balance) can push remaining negative on
      // their own.
      base.creditOwed = base.remaining < 0 ? round2(-base.remaining) : 0;
      base.remaining = base.remaining < 0 ? 0 : round2(base.remaining);
    }

    return base;
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

    // The payment/return lookup+adjustment stages are only added when
    // PaymentModel/ReturnModel are provided (Customer) — Supplier's
    // pipeline is built exactly as before, stage for stage.
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

    const excludeProjection = { _tx: 0 };
    if (PaymentModel) excludeProjection._payments = 0;
    if (ReturnModel) excludeProjection._returns = 0;

    itemsPipeline.push(
      {
        $addFields: {
          'totals.remaining': ReturnModel
            ? { $subtract: [{ $subtract: ['$totals.total', '$totals.paid'] }, '$totals.returned'] }
            : { $subtract: ['$totals.total', '$totals.paid'] },
        },
      },
    );

    if (ReturnModel) {
      // Same floor-at-0 + creditOwed split as getTotals — a return can
      // legitimately push the raw remaining negative (return eligibility is
      // quantity-based only, never blocked by balance), and that excess is
      // surfaced rather than hidden or clamped away silently.
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

  /**
   * Existing people who share this new one's phone (exact — a phone number
   * genuinely identifies one person) OR name (case/whitespace-insensitive
   * exact match — catches "أحمد علي" vs "احمد على" typo-level variance
   * only, not a fuzzy/partial match that would flag unrelated people who
   * simply share a first name). Used to warn before creating what might be
   * an accidental second record for someone who already exists — nothing
   * here is a hard uniqueness rule; two genuinely different people can
   * share a name, and this never blocks — see `create`.
   */
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

  /**
   * `allowDuplicate` (default false): when a possible duplicate exists (see
   * findDuplicates) and this isn't set, the create is rejected with a 409
   * carrying the matches, instead of silently creating a second record for
   * someone who may already be in the system — a real, confirmed gap
   * before this fix (nothing checked this at all). The frontend shows
   * those matches and lets the person confirm they genuinely want a new,
   * separate record, then resubmits with `allowDuplicate: true` to go
   * through anyway — this never becomes a hard block.
   */
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

  /**
   * Checks for existing transactions BEFORE checking the person exists —
   * matching the frontend's exact check order in delete{Customer,Supplier}Svc.
   * When PaymentModel is provided, a person with standalone payments on file
   * (even with no Sale, an edge case in practice) is blocked the same way —
   * deleting them would otherwise orphan those payment records.
   */
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
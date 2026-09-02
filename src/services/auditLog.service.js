import AuditLog from '../models/AuditLog.js';
import { getRequestContext } from '../utils/requestContext.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Records one structured audit entry. The acting device is normally read
 * from the async request context (populated by `requireAuth` — see
 * utils/requestContext.js) rather than passed explicitly, which is what
 * keeps every other service's function signatures unchanged; pass
 * `actorDeviceId` explicitly only where no such context exists yet — the
 * shop login flow itself, which runs before authentication succeeds.
 *
 * Pass `{ session }` to participate in an existing MongoDB transaction —
 * same reasoning as `recordActivity`: a failed operation should never leave
 * behind an audit entry claiming it happened.
 */
export async function recordAuditLog({ action, entityType, entityId = null, values = {}, actorDeviceId }, { session } = {}) {
  const context = getRequestContext();
  const deviceId = actorDeviceId !== undefined ? actorDeviceId : context?.deviceId || null;
  await AuditLog.create([{ action, entityType, entityId, actorDeviceId: deviceId, values }], { session });
}

/** Read-only, paginated. Filterable by action, entityType, actorDeviceId, and a date range. */
export async function listAuditLogs({ page = 1, limit = DEFAULT_PAGE_SIZE, action, entityType, actorDeviceId, from, to } = {}) {
  const match = {};
  if (action) match.action = action;
  if (entityType) match.entityType = entityType;
  if (actorDeviceId) match.actorDeviceId = actorDeviceId;
  if (from || to) {
    match.at = {};
    if (from) match.at.$gte = new Date(`${from}T00:00:00`);
    if (to) match.at.$lte = new Date(`${to}T23:59:59`);
  }

  const pageNum = Math.max(1, Math.trunc(Number(page)) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(limit)) || DEFAULT_PAGE_SIZE));
  const skip = (pageNum - 1) * pageSize;

  const [{ items, totalCount }] = await AuditLog.aggregate([
    { $match: match },
    { $sort: { at: -1 } },
    {
      $facet: {
        items: [{ $skip: skip }, { $limit: pageSize }],
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

export default { recordAuditLog, listAuditLogs };

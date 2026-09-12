import Purchase from '../models/Purchase.js';
import SupplierPayment from '../models/SupplierPayment.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import SupplierCreditReceipt from '../models/SupplierCreditReceipt.js';
import { getPersonRemaining } from './personBalance.service.js';

/**
 * Thin Supplier-specific wrapper over the generic getPersonRemaining (see
 * personBalance.service.js) — the mirror of customerBalance.service.js's
 * getCustomerRemaining, but reading Purchase/SupplierPayment/PurchaseReturn
 * instead of Sale/CustomerPayment/SalesReturn. Same "how much do we
 * currently owe THIS supplier" figure supplierPayment.service.js and
 * purchaseReturn.service.js both validate against — kept as one function so
 * they can never compute it differently from each other.
 */
export async function getSupplierRemaining(supplierId, session) {
  return getPersonRemaining({
    TransactionModel: Purchase,
    PaymentModel: SupplierPayment,
    ReturnModel: PurchaseReturn,
    PayoutModel: SupplierCreditReceipt,
    refField: 'supplierId',
    personId: supplierId,
    session,
  });
}

export default getSupplierRemaining;
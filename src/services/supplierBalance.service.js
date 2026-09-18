import Purchase from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
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
    PersonModel: Supplier,
    // 'we_owe_them' (the shop owes the supplier) is the SAME polarity as
    // Purchase.total - Purchase.paid being positive — the OPPOSITE label
    // from the customer side (see getPersonRemaining's own docstring for
    // why: raw positive means "they owe us" for a customer, but "we owe
    // them" for a supplier). This was the confirmed bug: before this fix,
    // this line read 'they_owe_us' (copied from the customer wrapper),
    // which silently inverted every supplier opening balance.
    openingBalancePositiveDirection: 'we_owe_them',
    refField: 'supplierId',
    personId: supplierId,
    session,
  });
}

export default getSupplierRemaining;
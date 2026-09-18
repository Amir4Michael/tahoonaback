import Sale from '../models/Sale.js';
import Customer from '../models/Customer.js';
import CustomerPayment from '../models/CustomerPayment.js';
import SalesReturn from '../models/SalesReturn.js';
import CustomerCreditPayout from '../models/CustomerCreditPayout.js';
import { getPersonRemaining } from './personBalance.service.js';

/**
 * Thin Customer-specific wrapper over the generic getPersonRemaining (see
 * personBalance.service.js — shared with supplierBalance.service.js so
 * Customer and Supplier can never compute this differently from each
 * other). Kept as its own small function (rather than inlining the model
 * list at every call site) so customerPayment.service.js and
 * salesReturn.service.js don't each need to know which models feed a
 * customer's balance.
 */
export async function getCustomerRemaining(customerId, session) {
  return getPersonRemaining({
    TransactionModel: Sale,
    PaymentModel: CustomerPayment,
    ReturnModel: SalesReturn,
    PayoutModel: CustomerCreditPayout,
    PersonModel: Customer,
    // 'they_owe_us' (the customer owes the shop) is the SAME polarity as
    // Sale.total - Sale.paid being positive — see getPersonRemaining's own
    // docstring for why this differs from the supplier side.
    openingBalancePositiveDirection: 'they_owe_us',
    refField: 'customerId',
    personId: customerId,
    session,
  });
}

export default getCustomerRemaining;
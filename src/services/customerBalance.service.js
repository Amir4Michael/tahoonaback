import Sale from '../models/Sale.js';
import CustomerPayment from '../models/CustomerPayment.js';
import SalesReturn from '../models/SalesReturn.js';
import CustomerCreditPayout from '../models/CustomerCreditPayout.js';
import { getPersonRemaining } from './personBalance.service.js';

export async function getCustomerRemaining(customerId, session) {
  return getPersonRemaining({
    TransactionModel: Sale,
    PaymentModel: CustomerPayment,
    ReturnModel: SalesReturn,
    PayoutModel: CustomerCreditPayout,
    refField: 'customerId',
    personId: customerId,
    session,
  });
}

export default getCustomerRemaining;
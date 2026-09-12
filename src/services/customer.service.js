import Customer from '../models/Customer.js';
import Sale from '../models/Sale.js';
import CustomerPayment from '../models/CustomerPayment.js';
import SalesReturn from '../models/SalesReturn.js';
import CustomerCreditPayout from '../models/CustomerCreditPayout.js';
import { createPersonService } from './personService.js';

export const customerService = createPersonService({
  Model: Customer,
  TransactionModel: Sale,
  refField: 'customerId',
  activityType: 'customer',
  entityType: 'Customer',
  PaymentModel: CustomerPayment,
  ReturnModel: SalesReturn,
  PayoutModel: CustomerCreditPayout,
  labels: {
    notFound: 'العميل غير موجود',
    deleteBlocked: 'لا يمكن حذف عميل له فواتير مسجلة',
    added: 'تمت إضافة عميل جديد',
    updated: 'تم تعديل بيانات العميل',
    deleted: 'تم حذف العميل',
  },
});

export default customerService;
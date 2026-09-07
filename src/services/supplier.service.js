import Supplier from '../models/Supplier.js';
import Purchase from '../models/Purchase.js';
import SupplierPayment from '../models/SupplierPayment.js';
import PurchaseReturn from '../models/PurchaseReturn.js';
import { createPersonService } from './personService.js';

export const supplierService = createPersonService({
  Model: Supplier,
  TransactionModel: Purchase,
  refField: 'supplierId',
  activityType: 'supplier',
  entityType: 'Supplier',
  // Standalone settlements WE pay to the supplier (see SupplierPayment.js /
  // supplierPayment.service.js) that reduce our running balance without
  // touching any Purchase.
  PaymentModel: SupplierPayment,
  // Standalone returns of goods back to the supplier (see PurchaseReturn.js
  // / purchaseReturn.service.js) that reduce our running balance without
  // touching any Purchase.
  ReturnModel: PurchaseReturn,
  labels: {
    notFound: 'المورد غير موجود',
    deleteBlocked: 'لا يمكن حذف مورد له عمليات شراء مسجلة',
    added: 'تمت إضافة مورد جديد',
    updated: 'تم تعديل بيانات المورد',
    deleted: 'تم حذف المورد',
  },
});

export default supplierService;

import Supplier from '../models/Supplier.js';
import Purchase from '../models/Purchase.js';
import { createPersonService } from './personService.js';

export const supplierService = createPersonService({
  Model: Supplier,
  TransactionModel: Purchase,
  refField: 'supplierId',
  activityType: 'supplier',
  entityType: 'Supplier',
  labels: {
    notFound: 'المورد غير موجود',
    deleteBlocked: 'لا يمكن حذف مورد له عمليات شراء مسجلة',
    added: 'تمت إضافة مورد جديد',
    updated: 'تم تعديل بيانات المورد',
    deleted: 'تم حذف المورد',
  },
});

export default supplierService;

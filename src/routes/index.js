import { Router } from 'express';
import healthRoute from './health.route.js';
import authRoute from './auth.route.js';
import productRoute from './product.route.js';
import customerRoute from './customer.route.js';
import supplierRoute from './supplier.route.js';
import saleRoute from './sale.route.js';
import purchaseRoute from './purchase.route.js';
import customerPaymentRoute from './customerPayment.route.js';
import salesReturnRoute from './salesReturn.route.js';
import supplierPaymentRoute from './supplierPayment.route.js';
import purchaseReturnRoute from './purchaseReturn.route.js';
import cashboxRoute from './cashbox.route.js';
import expenseRoute from './expense.route.js';
import reportsRoute from './reports.route.js';
import auditLogRoute from './auditLog.route.js';
import activityRoute from './activity.route.js';
import settingsRoute from './settings.route.js';
import uploadRoute from './upload.route.js';
import adminRoute from './admin.route.js';

const router = Router();

router.use('/health', healthRoute);
router.use('/auth', authRoute);
router.use('/products', productRoute);
router.use('/customers', customerRoute);
router.use('/suppliers', supplierRoute);
router.use('/sales', saleRoute);
router.use('/purchases', purchaseRoute);
router.use('/customer-payments', customerPaymentRoute);
router.use('/sales-returns', salesReturnRoute);
router.use('/supplier-payments', supplierPaymentRoute);
router.use('/purchase-returns', purchaseReturnRoute);
router.use('/cashbox', cashboxRoute);
router.use('/expenses', expenseRoute);
router.use('/reports', reportsRoute);
router.use('/audit-log', auditLogRoute);
router.use('/activity', activityRoute);
router.use('/settings', settingsRoute);
router.use('/uploads', uploadRoute);

// Separate, self-contained, GET-only read model for the future System 5 —
// gated by its own key (requireAdminReadKey), never by the shop's own
// login. See src/middleware/adminAccess.js and src/routes/admin.route.js.
router.use('/admin', adminRoute);

export default router;

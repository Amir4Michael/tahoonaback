import { createPersonRouter } from './personRoutes.js';
import { supplierService } from '../services/supplier.service.js';

export default createPersonRouter(supplierService);

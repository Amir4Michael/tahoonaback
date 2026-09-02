import { createPersonRouter } from './personRoutes.js';
import { customerService } from '../services/customer.service.js';

export default createPersonRouter(customerService);

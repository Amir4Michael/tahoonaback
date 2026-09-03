process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-only-access-secret-not-for-production';
process.env.ADMIN_READONLY_KEY = process.env.ADMIN_READONLY_KEY || 'test-only-admin-readonly-key-not-for-production';

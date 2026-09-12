import { asyncHandler } from '../middleware/asyncHandler.js';
import * as productService from '../services/product.service.js';

export const list = asyncHandler(async (req, res) => {
  const { page, limit, search, filter, sort } = req.validatedQuery;
  const result = await productService.listProducts({ page, limit, search, filter, sort });
  res.json({ success: true, data: result.items, pagination: result.pagination });
});

export const getOne = asyncHandler(async (req, res) => {
  const product = await productService.getProduct(req.params.id);
  res.json({ success: true, data: product });
});

export const create = asyncHandler(async (req, res) => {
  const product = await productService.createProduct(req.body);
  res.status(201).json({ success: true, data: product });
});

export const update = asyncHandler(async (req, res) => {
  const product = await productService.updateProduct(req.params.id, req.body);
  res.json({ success: true, data: product });
});

export const remove = asyncHandler(async (req, res) => {
  const result = await productService.deleteProduct(req.params.id);
  res.json({ success: true, hidden: result.hidden });
});

export const restore = asyncHandler(async (req, res) => {
  const product = await productService.restoreProduct(req.params.id);
  res.json({ success: true, data: product });
});
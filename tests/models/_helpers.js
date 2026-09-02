/**
 * Finds a declared index on a Mongoose model matching the given key(s),
 * e.g. findIndex(Product, { code: 1 }). Returns the [keySpec, options] tuple
 * from schema.indexes(), or undefined if no matching index is declared.
 */
export function findIndex(Model, keySpec) {
  const wanted = JSON.stringify(keySpec);
  return Model.schema.indexes().find(([key]) => JSON.stringify(key) === wanted);
}

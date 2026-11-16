// @types/css-tree only types the main entry; the subpath modules export the same functions.
declare module "css-tree/parser" {
  const parse: typeof import("css-tree").parse;
  export default parse;
}

declare module "css-tree/walker" {
  const walk: typeof import("css-tree").walk;
  export default walk;
}

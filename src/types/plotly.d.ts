// plotly.js-dist-min は型定義を同梱しないため手動宣言
declare module "plotly.js-dist-min" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Plotly: any;
  export default Plotly;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export = Plotly;
}

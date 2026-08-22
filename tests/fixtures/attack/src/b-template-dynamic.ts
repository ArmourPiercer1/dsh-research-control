// Attack B: dynamic import with a template literal (regex only allows ' or ").
const m = await import(`@deepseek-ai/cordis`)
export default m

// Attack C: require via an aliased caller (createRequire), not a literal require(...).
import { createRequire } from 'node:module'
const r = createRequire(import.meta.url)
const cordis = r('@deepseek-ai/cordis')
export default cordis

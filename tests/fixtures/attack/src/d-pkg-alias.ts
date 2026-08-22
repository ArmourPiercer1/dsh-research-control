// Attack D: npm dependency alias — package.json maps "cordis-alias" to
// npm:@deepseek-ai/cordis@4.0.1; the in-source specifier is benign.
import { Service } from 'cordis-alias'
export const y = Service

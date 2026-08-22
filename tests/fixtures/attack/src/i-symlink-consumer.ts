// Attack H/I: consume DSH internal modules through symlinks.
import type { Branded } from './sneaky-file.js'
import type { Branded as B2 } from './sneakydir/index.js'
export type T = Branded<'x'> | B2<'y'>

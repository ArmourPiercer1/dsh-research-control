// WP-0.1: placeholder test (scaffold stage only, no business logic).
// Exists solely to keep the vitest pipeline green until WP-0.2+ adds real tests.
import { describe, expect, it } from 'vitest';

describe('WP-0.1 scaffold (placeholder)', () => {
  it('scaffold is in place', () => {
    expect({ ok: true }).toEqual({ ok: true });
  });
});

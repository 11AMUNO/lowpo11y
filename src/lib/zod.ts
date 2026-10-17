/**
 * The one place the app imports zod from. Validation runs in the browser
 * and in workers as well as on the server, and the site's Content Security
 * Policy has no 'unsafe-eval': zod's optional JIT probes `new Function`,
 * which the browser reports as a policy violation even though zod catches
 * it. `jitless` skips the probe; parsing is unchanged. ESLint keeps every
 * other module importing from here, so this runs first in every bundle.
 */
import { z } from "zod";

z.config({ jitless: true });

export { z };
export { ZodError } from "zod";

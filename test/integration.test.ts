import * as path from 'node:path';
import { strict as assert } from 'node:assert';
import { tests } from '@iobroker/testing';

// Run the standard @iobroker/testing integration suite. It boots a fresh
// js-controller, installs this adapter and verifies that the instance starts
// up and stays running without crashing.
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        // Each suite gets its own freshly set-up test harness.
        suite('Adapter instance object', getHarness => {
            it('the instance object exists and is configured for this adapter', async () => {
                const harness = getHarness();

                const obj = await new Promise<any>((resolve, reject) => {
                    harness.objects.getObject(
                        `system.adapter.${harness.adapterName}.0`,
                        (err: Error | null, o: any) => (err ? reject(err) : resolve(o)),
                    );
                });

                assert.ok(obj, 'The adapter instance object must exist');
                assert.equal(obj.type, 'instance');
                assert.equal(obj.common.name, harness.adapterName);
            });
        });
    },
});

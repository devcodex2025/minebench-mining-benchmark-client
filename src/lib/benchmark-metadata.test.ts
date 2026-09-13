import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmarkMetadata } from './benchmark-metadata.ts';

test('serializes real reported system metadata without private fields', () => {
  assert.deepEqual(buildBenchmarkMetadata({os_name:'linux',os_arch:'x86_64',client_version:'0.8.33',cores:16,ramBytes:34359738368,xmrig_version:'6.25.0'}), {
    os_name:'linux',os_arch:'x86_64',client_version:'0.8.33',cpu_cores:16,ram_total_bytes:34359738368,xmrig_version:'6.25.0',
  });
});
test('omits missing or malformed readings instead of reporting fake zero values', () => {
  assert.deepEqual(buildBenchmarkMetadata({}), {});
  assert.deepEqual(buildBenchmarkMetadata({cores:0,ramBytes:32,client_version:'0.0.0',xmrig_version:'unavailable'}), {});
  assert.deepEqual(buildBenchmarkMetadata({os_name:'freebsd',os_arch:'riscv64',cores:1.5,ramBytes:NaN}), {os_name:'other',os_arch:'other'});
});

type MetadataInput = {
  os_name?: string; os_arch?: string; client_version?: string;
  cores?: number; ramBytes?: number; xmrig_version?: string;
};

export function buildBenchmarkMetadata(input: MetadataInput) {
  const result: Record<string, string | number> = {};
  if (input.os_name) result.os_name = ['windows', 'linux', 'macos'].includes(input.os_name) ? input.os_name : 'other';
  if (input.os_arch) result.os_arch = ['x86_64', 'aarch64', 'x86', 'arm'].includes(input.os_arch) ? input.os_arch : 'other';
  for (const field of ['client_version', 'xmrig_version'] as const) {
    const value = input[field];
    if (value && value !== '0.0.0' && value.length <= 64 && /^\d+\.\d+(?:\.\d+)?(?:[-+][a-zA-Z0-9.-]+)?$/.test(value)) result[field] = value;
  }
  if (Number.isInteger(input.cores) && input.cores! > 0 && input.cores! <= 4096) result.cpu_cores = input.cores!;
  if (Number.isSafeInteger(input.ramBytes) && input.ramBytes! >= 268435456 && input.ramBytes! <= 17592186044416) result.ram_total_bytes = input.ramBytes!;
  return result;
}

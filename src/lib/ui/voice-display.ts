import type { Voice } from '$lib/domain/schemas';

export function voiceSurfaceStatus(voice: Voice): 'PENDING' | 'RETURNED' | 'INVALID' | 'FAILED' {
	if (voice.job_status === 'failed' || voice.job_status === 'cancelled') return 'FAILED';
	if (voice.job_status === 'queued' || voice.job_status === 'running') return 'PENDING';
	if (voice.parse_status === 'invalid') return 'INVALID';
	if (voice.parse_status === 'valid') return 'RETURNED';
	return 'PENDING';
}

export const voiceStatusColor: Record<ReturnType<typeof voiceSurfaceStatus>, string> = {
	PENDING: 'var(--color-gate-pending)',
	RETURNED: 'var(--color-gate-approved)',
	INVALID: 'var(--color-gate-quoted)',
	FAILED: 'var(--color-gate-failed)'
};

import { CrApiService } from './cr-api.service';
import { users } from './fixtures';
import { fakeAsync, tick } from '@angular/core/testing';
import { CrDetail } from '../models/cr.models';

describe('CrApiService', () => {
	it('does not save an approval when the request fails', async () => {
		const api = new CrApiService();
		api.failNext = true;

		await expect(api.approve(users.approver, 'CR-1', '2026-03-03T12:00:00.000Z')).rejects.toThrow('Network error');

		const detail = await api.getChangeRequest(users.approver, 'CR-1');

		expect(detail.status).toBe('PENDING_APPROVAL');
		expect(detail.audit.some((entry) => entry.action === 'APPROVE')).toBe(false);
	});

	it('does not persist a failed rejection, and persists exactly one audit entry after retry', async () => {
		const api = new CrApiService();
		const at = '2026-03-03T12:00:00.000Z';
		api.failNext = true;
		await expect(api.reject(users.approver, 'CR-1', at, 'Revise pricing')).rejects.toThrow('Network error');
		const unchanged = await api.getChangeRequest(users.approver, 'CR-1');
		expect(unchanged.status).toBe('PENDING_APPROVAL');
		expect(unchanged.audit).toHaveLength(3);
		await api.reject(users.approver, 'CR-1', at, 'Revise pricing');
		const confirmed = await api.getChangeRequest(users.approver, 'CR-1');
		expect(confirmed.audit).toHaveLength(4);
		expect(confirmed.audit[3]).toEqual({ action: 'REJECT', byUserId: users.approver.id, at, note: 'Revise pricing' });
		const rows = await api.listChangeRequests(users.approver);
		expect(rows.find((row) => row.id === 'CR-1')?.status).toBe('REJECTED');
	});

	it('assigns failNext to the next invocation rather than whichever request finishes first', fakeAsync(() => {
		const api = new CrApiService();
		api.latencyMs = 100;
		api.failNext = true;
		let failure: Error | undefined;
		void api.listChangeRequests(users.approver).catch((error: Error) => {
			failure = error;
		});
		api.latencyMs = 0;
		let detail: CrDetail | undefined;
		void api.getChangeRequest(users.approver, 'CR-1').then((value) => {
			detail = value;
		});
		tick();
		expect(detail?.id).toBe('CR-1');
		expect(failure).toBeUndefined();
		tick(100);
		expect(failure?.message).toBe('Network error');
		expect(api.failNext).toBe(false);
	}));
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CrDetailComponent } from './cr-detail.component';
import { SessionService } from '../../session/session.service';
import { details, users } from '../../api/fixtures';
import { CrDetail, CrStatus, ReqUser } from '../../models/cr.models';
import { CrApiService } from '../../api/cr-api.service';

const flush = () => new Promise((r) => setTimeout(r, 0));

async function render(user: ReqUser, id: string): Promise<ComponentFixture<CrDetailComponent>> {
	TestBed.configureTestingModule({
		imports: [CrDetailComponent],
		providers: [{ provide: SessionService, useValue: { user } }],
	});
	await TestBed.compileComponents();
	const fixture = TestBed.createComponent(CrDetailComponent);
	fixture.componentInstance.id = id;
	fixture.detectChanges(); // ngOnInit -> load()
	await flush(); // let the mock API resolve
	fixture.detectChanges(); // render the loaded state
	return fixture;
}

describe('CrDetailComponent', () => {
	it('loads and renders the change request title', async () => {
		const fixture = await render(users.approver, 'CR-1');
		expect(fixture.nativeElement.querySelector('.cr-detail__header h2').textContent).toContain('Add 1 unit of SKU-A');
	});

	it('disables Approve for a read-only viewer on a pending CR', async () => {
		const fixture = await render(users.viewer, 'CR-1'); // viewer: cr_r_o only; CR-1 is PENDING_APPROVAL
		const approveBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__approve');
		expect(approveBtn.disabled).toBe(true);
	});

	it('renders timeline entries chronologically', async () => {
		const fixture = await render(users.approver, 'CR-1');

		const actions = Array.from(fixture.nativeElement.querySelectorAll('.cr-timeline__action') as NodeListOf<HTMLElement>, (el) =>
			el.textContent?.trim(),
		);

		expect(actions).toEqual(['CREATE', 'SUBMIT', 'SEND_FOR_APPROVAL']);
	});

	it('reloads details when the selected CR changes', async () => {
		const fixture = await render(users.approver, 'CR-1');

		fixture.componentRef.setInput('id', 'CR-2');
		fixture.detectChanges();

		await flush();
		fixture.detectChanges();

		const title = fixture.nativeElement.querySelector('.cr-detail__header h2');

		expect(title.textContent).toContain('Replace SKU-B supplier');
	});

	it('shows an error and restores actions after failed approval', async () => {
		const fixture = await render(users.approver, 'CR-1');
		const api = TestBed.inject(CrApiService);

		api.failNext = true;

		const button: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__approve');

		button.click();
		fixture.detectChanges();

		expect(button.disabled).toBe(true);

		await flush();
		fixture.detectChanges();

		const error = fixture.nativeElement.querySelector('.cr-actions__error');

		expect(error.textContent).toContain('Network error');
		expect(fixture.nativeElement.querySelector('.cr-status').textContent.trim()).toBe('PENDING_APPROVAL');

		expect(button.disabled).toBe(false);
	});

	it('prevents duplicate approval requests', async () => {
		const fixture = await render(users.approver, 'CR-1');
		const api = TestBed.inject(CrApiService);

		const spy = jest.spyOn(api, 'approve');

		const button: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__approve');

		button.click();
		button.click();

		expect(spy).toHaveBeenCalledTimes(1);

		await flush();
		fixture.detectChanges();
	});

	it('does not overwrite another CR after approval completes', async () => {
		// 1. Open CR-1
		const fixture = await render(users.approver, 'CR-1');
		const api = TestBed.inject(CrApiService);

		const original = fixture.componentInstance.detail as CrDetail;
		let resolveApproval!: (cr: CrDetail) => void;

		// 2. Simulate an API approval that stays pending
		jest.spyOn(api, 'approve').mockImplementation(
			() =>
				new Promise<CrDetail>((resolve) => {
					resolveApproval = resolve;
				}),
		);

		// 3. Click Approve on CR-1
		const button: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__approve');

		button.click();

		// 4. Before approval finishes, switch to CR-2
		fixture.componentRef.setInput('id', 'CR-2');
		fixture.detectChanges();

		await flush();
		fixture.detectChanges();

		// 5. Now finish the original CR-1 approval
		resolveApproval({ ...original, status: 'APPROVED' });

		await flush();
		fixture.detectChanges();

		// 6. The screen must STILL display CR-2
		expect(fixture.nativeElement.querySelector('.cr-detail__header h2').textContent).toContain('Replace SKU-B supplier');
	});

	it('renders description-only changes', async () => {
		const fixture = await render(users.approver, 'CR-2');

		const row: HTMLElement = fixture.nativeElement.querySelector('.cr-diff__row');

		expect(row.getAttribute('data-kind')).toBe('changed');
		expect(row.textContent).toContain('Widget B (new supplier)');
		expect(row.textContent).toContain('Widget B');
	});
});

describe('CrDetailComponent rendered edge cases', () => {
	beforeEach(async () => {
		jest.useFakeTimers();
		TestBed.configureTestingModule({ imports: [CrDetailComponent] });
		await TestBed.compileComponents();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	function start(user: ReqUser = users.approver): ComponentFixture<CrDetailComponent> {
		TestBed.inject(SessionService).user = user;
		const fixture = TestBed.createComponent(CrDetailComponent);
		fixture.componentRef.setInput('id', 'CR-1');
		fixture.detectChanges();
		return fixture;
	}

	function reason(fixture: ComponentFixture<CrDetailComponent>, value: string): void {
		const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('.cr-actions__reason');
		textarea.value = value;
		textarea.dispatchEvent(new Event('input'));
		textarea.dispatchEvent(new Event('blur'));
		fixture.detectChanges();
	}

	function button(fixture: ComponentFixture<CrDetailComponent>, action: 'approve' | 'reject'): HTMLButtonElement {
		return fixture.nativeElement.querySelector(action === 'approve' ? '.cr-actions__approve' : '.cr-actions__reject-btn');
	}

	it('renders loading without old data or actions until a slow detail request completes', async () => {
		TestBed.inject(CrApiService).latencyMs = 100;
		const fixture = start();
		expect(fixture.nativeElement.querySelector('.cr-detail__loading').getAttribute('role')).toBe('status');
		expect(fixture.nativeElement.querySelector('.cr-detail__header')).toBeNull();
		expect(button(fixture, 'approve')).toBeNull();
		await jest.advanceTimersByTimeAsync(99);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-detail__loading')).not.toBeNull();
		await jest.advanceTimersByTimeAsync(1);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('h2').textContent).toContain(details['CR-1'].title);
		expect(fixture.nativeElement.querySelector('.cr-detail__loading')).toBeNull();
	});

	it('renders a detail error and retries through the DOM', async () => {
		TestBed.inject(CrApiService).failNext = true;
		const fixture = start();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		const error: HTMLElement = fixture.nativeElement.querySelector('.cr-detail__error');
		expect(error.textContent).toContain('Network error');
		expect(button(fixture, 'approve')).toBeNull();
		(error.querySelector('button') as HTMLButtonElement).click();
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-detail__loading')).not.toBeNull();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('h2').textContent).toContain(details['CR-1'].title);
		expect(fixture.nativeElement.querySelector('.cr-detail__error')).toBeNull();
	});

	it.each(['', ' \n\t '])('blocks rejection for an invalid reason %j and renders validation', async (value: string) => {
		const api = TestBed.inject(CrApiService);
		const reject = jest.spyOn(api, 'reject');
		const fixture = start();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		reason(fixture, value);
		expect(button(fixture, 'reject').disabled).toBe(true);
		expect(fixture.nativeElement.querySelector('.cr-actions__reason-error').textContent).toContain('Please enter a reason');
		button(fixture, 'reject').click();
		void fixture.componentInstance.reject(); // The component also guards callers that bypass the disabled button.
		expect(reject).not.toHaveBeenCalled();
	});

	it('rejects with a trimmed reason, keeps confirmed data while pending, and appends the timeline note', async () => {
		const api = TestBed.inject(CrApiService);
		const reject = jest.spyOn(api, 'reject');
		const fixture = start();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		const completed = jest.spyOn(fixture.componentInstance.decisionCompleted, 'emit');
		reason(fixture, '  Price is too high  ');
		api.latencyMs = 100;
		button(fixture, 'reject').click();
		fixture.detectChanges();
		expect(reject).toHaveBeenCalledWith(users.approver, 'CR-1', expect.any(String), 'Price is too high');
		expect(button(fixture, 'approve').disabled).toBe(true);
		expect(button(fixture, 'reject').disabled).toBe(true);
		expect(fixture.nativeElement.querySelector('.cr-status').textContent.trim()).toBe('PENDING_APPROVAL');
		expect(fixture.nativeElement.querySelectorAll('.cr-timeline__entry')).toHaveLength(3);
		await jest.advanceTimersByTimeAsync(100);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-status').textContent.trim()).toBe('REJECTED');
		const timeline = fixture.nativeElement.querySelectorAll('.cr-timeline__entry');
		expect(timeline).toHaveLength(4);
		expect(timeline[3].textContent).toContain('REJECT');
		expect(timeline[3].textContent).toContain('Price is too high');
		expect(button(fixture, 'approve').disabled).toBe(true);
		expect(button(fixture, 'reject')).toBeNull();
		expect(completed).toHaveBeenCalledTimes(1);
	});

	it('preserves confirmed detail and the typed reason on Reject failure, then supports retry', async () => {
		const api = TestBed.inject(CrApiService);
		const fixture = start();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		const confirmed = fixture.componentInstance.detail;
		const completed = jest.spyOn(fixture.componentInstance.decisionCompleted, 'emit');
		reason(fixture, 'Wrong quantity');
		api.failNext = true;
		button(fixture, 'reject').click();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-actions__error').textContent).toContain('Network error');
		expect(fixture.componentInstance.detail).toBe(confirmed);
		expect(fixture.nativeElement.querySelector('.cr-status').textContent.trim()).toBe('PENDING_APPROVAL');
		expect(fixture.nativeElement.querySelectorAll('.cr-timeline__entry')).toHaveLength(3);
		expect(fixture.nativeElement.querySelector('.cr-actions__reason').value).toBe('Wrong quantity');
		expect(button(fixture, 'reject').disabled).toBe(false);
		expect(completed).not.toHaveBeenCalled();
		button(fixture, 'reject').click();
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-actions__error')).toBeNull();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-status').textContent.trim()).toBe('REJECTED');
		expect(completed).toHaveBeenCalledTimes(1);
	});

	it('guards duplicate Reject clicks and competing Approve clicks before change detection', async () => {
		const api = TestBed.inject(CrApiService);
		const reject = jest.spyOn(api, 'reject');
		const approve = jest.spyOn(api, 'approve');
		const fixture = start();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		reason(fixture, 'Not required');
		api.latencyMs = 100;
		button(fixture, 'reject').click();
		button(fixture, 'reject').click();
		button(fixture, 'approve').click();
		expect(reject).toHaveBeenCalledTimes(1);
		expect(approve).not.toHaveBeenCalled();
		fixture.detectChanges();
		expect(button(fixture, 'reject').disabled).toBe(true);
		await jest.advanceTimersByTimeAsync(100);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-status').textContent.trim()).toBe('REJECTED');
	});

	it.each<CrStatus>(['DRAFT', 'SUBMITTED', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED'])(
		'does not offer enabled decisions for status %s',
		async (status: CrStatus) => {
			const api = TestBed.inject(CrApiService);
			jest.spyOn(api, 'getChangeRequest').mockResolvedValue({ ...details['CR-1'], status });
			const approve = jest.spyOn(api, 'approve');
			const reject = jest.spyOn(api, 'reject');
			const fixture = start();
			await jest.advanceTimersByTimeAsync(0);
			fixture.detectChanges();
			expect(button(fixture, 'approve').disabled).toBe(true);
			expect(button(fixture, 'reject')).toBeNull();
			fixture.componentInstance.rejectControl.setValue('A reason');
			void fixture.componentInstance.approve();
			void fixture.componentInstance.reject();
			expect(approve).not.toHaveBeenCalled();
			expect(reject).not.toHaveBeenCalled();
		},
	);

	it.each([users.viewer, users.otherOrg])('blocks decisions after switching to user $id', async (user: ReqUser) => {
		const api = TestBed.inject(CrApiService);
		const approve = jest.spyOn(api, 'approve');
		const reject = jest.spyOn(api, 'reject');
		const fixture = start();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		TestBed.inject(SessionService).user = user;
		fixture.detectChanges();
		expect(button(fixture, 'approve').disabled).toBe(true);
		expect(button(fixture, 'reject')).toBeNull();
		fixture.componentInstance.rejectControl.setValue('A reason');
		void fixture.componentInstance.approve();
		void fixture.componentInstance.reject();
		expect(approve).not.toHaveBeenCalled();
		expect(reject).not.toHaveBeenCalled();
	});

	it('does not expose a CR from another organization', async () => {
		const fixture = start(users.otherOrg);
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-detail__error').textContent).toContain('Not found');
		expect(fixture.nativeElement.querySelector('.cr-detail__header')).toBeNull();
		expect(button(fixture, 'approve')).toBeNull();
		expect(button(fixture, 'reject')).toBeNull();
	});

	it('renders all four diff kinds, before/after cells, totals, and a negative delta', async () => {
		const a = { sku: 'A', description: 'Changed item', quantity: 2, unitPrice: 5 };
		const b = { sku: 'B', description: 'Same item', quantity: 1, unitPrice: 20 };
		const c = { sku: 'C', description: 'Removed item', quantity: 1, unitPrice: 30 };
		const d = { sku: 'D', description: 'Added item', quantity: 1, unitPrice: 10 };
		jest.spyOn(TestBed.inject(CrApiService), 'getChangeRequest').mockResolvedValue({
			...details['CR-1'],
			baselineLineItems: [a, b, c],
			proposedLineItems: [{ ...a, quantity: 1 }, b, d],
			baselineTotal: 60,
			newTotal: 35,
			delta: -25,
		});
		const fixture = start();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		const rows = Array.from(fixture.nativeElement.querySelectorAll('.cr-diff__row') as NodeListOf<HTMLTableRowElement>);
		expect(rows.map((row) => row.dataset['kind'])).toEqual(['changed', 'unchanged', 'removed', 'added']);
		expect(rows[0].cells[2].textContent).toContain('2 × USD 5.00');
		expect(rows[0].cells[3].textContent).toContain('1 × USD 5.00');
		expect(rows[2].cells[2].textContent).toContain('Removed item');
		expect(rows[2].cells[3].textContent?.trim()).toBe('—');
		expect(rows[3].cells[2].textContent?.trim()).toBe('—');
		expect(rows[3].cells[3].textContent).toContain('Added item');
		const totals: HTMLElement = fixture.nativeElement.querySelector('.cr-detail__totals');
		expect(totals.textContent).toContain('USD 60.00');
		expect(totals.textContent).toContain('USD 35.00');
		expect(fixture.nativeElement.querySelector('.cr-detail__delta').textContent).toContain('USD -25.00');
	});

	it.each(['success', 'failure'])('ignores a stale detail %s after navigating to another CR', async (outcome: string) => {
		let resolve!: (detail: CrDetail) => void;
		let reject!: (error: Error) => void;
		jest.spyOn(TestBed.inject(CrApiService), 'getChangeRequest').mockImplementationOnce(
			() =>
				new Promise<CrDetail>((res, rej) => {
					resolve = res;
					reject = rej;
				}),
		);
		const fixture = start();
		fixture.componentRef.setInput('id', 'CR-2');
		fixture.detectChanges();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		if (outcome === 'success') resolve(details['CR-1']);
		else reject(new Error('Old request failed'));
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('h2').textContent).toContain(details['CR-2'].title);
		expect(fixture.nativeElement.querySelector('.cr-detail__error')).toBeNull();
	});

	it.each([false, true])('does not let a pre-decision read overwrite confirmed approval (read failure: %s)', async (failRead) => {
		const api = TestBed.inject(CrApiService);
		const fixture = start();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		api.latencyMs = 100;
		button(fixture, 'approve').click();
		api.latencyMs = 200;
		api.failNext = failRead;
		void fixture.componentInstance.load();
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-detail__loading')).not.toBeNull();
		await jest.advanceTimersByTimeAsync(100);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-status').textContent.trim()).toBe('APPROVED');
		await jest.advanceTimersByTimeAsync(100);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-status').textContent.trim()).toBe('APPROVED');
		expect(fixture.nativeElement.querySelector('.cr-detail__error')).toBeNull();
	});

	it.each([
		['approve', 'success'],
		['approve', 'failure'],
		['reject', 'success'],
		['reject', 'failure'],
	] as const)('does not let a stale %s %s change or unlock a new decision', async (action: 'approve' | 'reject', outcome: string) => {
		const api = TestBed.inject(CrApiService);
		const fixture = start();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		reason(fixture, 'Reason for CR-1');
		let completeOld!: (detail: CrDetail) => void;
		let failOld!: (error: Error) => void;
		jest.spyOn(api, action).mockImplementationOnce(
			() =>
				new Promise<CrDetail>((resolve, reject) => {
					completeOld = resolve;
					failOld = reject;
				}),
		);
		button(fixture, action).click();
		jest.spyOn(api, 'getChangeRequest').mockResolvedValueOnce({ ...details['CR-2'], status: 'PENDING_APPROVAL' });
		fixture.componentRef.setInput('id', 'CR-2');
		fixture.detectChanges();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-actions__reason').value).toBe('');
		expect(button(fixture, 'approve').disabled).toBe(false);
		let completeNew!: (detail: CrDetail) => void;
		jest.spyOn(api, 'approve').mockImplementationOnce(
			() =>
				new Promise<CrDetail>((resolve) => {
					completeNew = resolve;
				}),
		);
		button(fixture, 'approve').click();
		fixture.detectChanges();
		if (outcome === 'success') completeOld({ ...details['CR-1'], status: action === 'approve' ? 'APPROVED' : 'REJECTED' });
		else failOld(new Error('Old action failed'));
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('h2').textContent).toContain(details['CR-2'].title);
		expect(fixture.nativeElement.querySelector('.cr-actions__error')).toBeNull();
		expect(button(fixture, 'approve').disabled).toBe(true);
		completeNew({ ...details['CR-2'], status: 'APPROVED' });
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-status').textContent.trim()).toBe('APPROVED');
	});
});

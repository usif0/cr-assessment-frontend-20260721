import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CrListComponent } from './cr-list.component';
import { SessionService } from '../../session/session.service';
import { summaries, users } from '../../api/fixtures';
import { CrSummary, ReqUser } from '../../models/cr.models';
import { CrApiService } from '../../api/cr-api.service';

const flush = () => new Promise((r) => setTimeout(r, 0));

async function render(user: ReqUser): Promise<ComponentFixture<CrListComponent>> {
	TestBed.configureTestingModule({
		imports: [CrListComponent],
		providers: [{ provide: SessionService, useValue: { user } }],
	});
	await TestBed.compileComponents();
	const fixture = TestBed.createComponent(CrListComponent);
	fixture.detectChanges(); // ngOnInit -> load()
	await flush(); // let the mock API resolve
	fixture.detectChanges(); // render the loaded/empty state
	return fixture;
}

describe('CrListComponent', () => {
	it('renders a row per change request in the user org', async () => {
		const fixture = await render(users.approver);
		expect(fixture.nativeElement.querySelectorAll('.cr-list__row').length).toBe(3); // org-alpha: CR-1, CR-2, CR-3
	});

	it('shows the empty state when the org has no change requests', async () => {
		const fixture = await render({ id: 'x', orgCode: 'org-empty', policies: ['cr_r_o'] });
		expect(fixture.nativeElement.querySelector('.cr-list__empty')).not.toBeNull();
		expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();
	});

	it('filters rendered rows by status', async () => {
		const fixture = await render(users.approver);

		const select: HTMLSelectElement = fixture.nativeElement.querySelector('.cr-list__filter');

		select.value = 'PENDING_APPROVAL';
		select.dispatchEvent(new Event('change'));

		fixture.detectChanges();

		const rows = fixture.nativeElement.querySelectorAll('.cr-list__row');

		expect(rows.length).toBe(1);
		expect(rows[0].textContent).toContain('CR-1');
	});

	it('shows loading, error, and retry states', async () => {
		const fixture = await render(users.approver);
		const api = TestBed.inject(CrApiService);

		// Simulate a network failure
		api.failNext = true;
		void fixture.componentInstance.load();
		fixture.detectChanges();

		// While waiting, show loading instead of old rows
		expect(fixture.nativeElement.querySelector('.cr-list__loading')).not.toBeNull();

		expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();

		// Let the API fail
		await flush();
		fixture.detectChanges();

		const error = fixture.nativeElement.querySelector('.cr-list__error');

		expect(error.textContent).toContain('Network error');

		// Retry the request
		const retryButton: HTMLButtonElement = error.querySelector('button');

		retryButton.click();

		await flush();
		fixture.detectChanges();

		// Data should be visible again
		expect(fixture.nativeElement.querySelectorAll('.cr-list__row').length).toBe(3);

		expect(fixture.nativeElement.querySelector('.cr-list__error')).toBeNull();
	});

	it('shows an empty message when no statuses match', async () => {
		const fixture = await render(users.approver);

		const select: HTMLSelectElement = fixture.nativeElement.querySelector('.cr-list__filter');

		select.value = 'REJECTED';
		select.dispatchEvent(new Event('change'));

		fixture.detectChanges();

		expect(fixture.nativeElement.querySelector('.cr-list__empty')).not.toBeNull();

		expect(fixture.nativeElement.querySelector('.cr-list__table')).toBeNull();
	});
});

describe('CrListComponent overlapping loads', () => {
	beforeEach(async () => {
		jest.useFakeTimers();
		TestBed.configureTestingModule({ imports: [CrListComponent] });
		await TestBed.compileComponents();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it.each(['success', 'failure'])('ignores an older list %s after a newer load finishes', async (outcome: string) => {
		const api = TestBed.inject(CrApiService);
		let resolveOld!: (rows: CrSummary[]) => void;
		let rejectOld!: (error: Error) => void;
		jest.spyOn(api, 'listChangeRequests').mockImplementationOnce(
			() =>
				new Promise<CrSummary[]>((resolve, reject) => {
					resolveOld = resolve;
					rejectOld = reject;
				}),
		);
		const fixture = TestBed.createComponent(CrListComponent);
		fixture.detectChanges();
		TestBed.inject(SessionService).user = users.otherOrg;
		void fixture.componentInstance.load();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelectorAll('.cr-list__row')).toHaveLength(1);
		expect(fixture.nativeElement.querySelector('.cr-list__row').textContent).toContain('CR-9');
		if (outcome === 'success') resolveOld(summaries.filter((row) => row.orgCode === users.approver.orgCode));
		else rejectOld(new Error('Old list failed'));
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelectorAll('.cr-list__row')).toHaveLength(1);
		expect(fixture.nativeElement.querySelector('.cr-list__row').textContent).toContain('CR-9');
		expect(fixture.nativeElement.querySelector('.cr-list__error')).toBeNull();
	});

	it('restores all rows when clearing a filter and emits the clicked CR id', async () => {
		const fixture = TestBed.createComponent(CrListComponent);
		fixture.detectChanges();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		const selected = jest.spyOn(fixture.componentInstance.select, 'emit');
		const filter: HTMLSelectElement = fixture.nativeElement.querySelector('.cr-list__filter');
		filter.value = 'APPLIED';
		filter.dispatchEvent(new Event('change'));
		fixture.detectChanges();
		const row: HTMLTableRowElement = fixture.nativeElement.querySelector('.cr-list__row');
		row.click();
		expect(selected).toHaveBeenCalledWith('CR-2');
		filter.value = 'ALL';
		filter.dispatchEvent(new Event('change'));
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelectorAll('.cr-list__row')).toHaveLength(3);
	});
});

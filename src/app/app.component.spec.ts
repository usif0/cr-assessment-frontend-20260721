import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import { CrApiService } from '../api/cr-api.service';

describe('AppComponent list/detail synchronization', () => {
	beforeEach(async () => {
		jest.useFakeTimers();
		TestBed.configureTestingModule({ imports: [AppComponent] });
		await TestBed.compileComponents();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it.each(['approve', 'reject'] as const)(
		'refreshes the filtered list only after %s succeeds, including a retry',
		async (action: 'approve' | 'reject') => {
			const fixture = TestBed.createComponent(AppComponent);
			fixture.detectChanges();
			await jest.advanceTimersByTimeAsync(0);
			fixture.detectChanges();
			const api = TestBed.inject(CrApiService);
			const list = jest.spyOn(api, 'listChangeRequests');
			const filter: HTMLSelectElement = fixture.nativeElement.querySelector('.cr-list__filter');
			filter.value = 'PENDING_APPROVAL';
			filter.dispatchEvent(new Event('change'));
			if (action === 'reject') {
				const reason: HTMLTextAreaElement = fixture.nativeElement.querySelector('.cr-actions__reason');
				reason.value = 'Please revise';
				reason.dispatchEvent(new Event('input'));
			}
			fixture.detectChanges();
			const button: HTMLButtonElement = fixture.nativeElement.querySelector(
				action === 'approve' ? '.cr-actions__approve' : '.cr-actions__reject-btn',
			);
			api.failNext = true;
			button.click();
			await jest.advanceTimersByTimeAsync(0);
			fixture.detectChanges();
			expect(fixture.nativeElement.querySelector('.cr-actions__error').textContent).toContain('Network error');
			expect(fixture.nativeElement.querySelector('.cr-list__row').textContent).toContain('PENDING_APPROVAL');
			expect(fixture.nativeElement.querySelector('.cr-detail__header .cr-status').textContent.trim()).toBe('PENDING_APPROVAL');
			expect(list).not.toHaveBeenCalled();
			button.click();
			await jest.advanceTimersByTimeAsync(0);
			fixture.detectChanges();
			expect(list).toHaveBeenCalledTimes(1);
			expect(fixture.nativeElement.querySelector('.cr-list__loading')).not.toBeNull();
			await jest.runAllTimersAsync();
			fixture.detectChanges();
			expect(fixture.nativeElement.querySelector('.cr-list__row')).toBeNull();
			expect(fixture.nativeElement.querySelector('.cr-list__empty').textContent).toContain('match the selected status');
			filter.value = 'ALL';
			filter.dispatchEvent(new Event('change'));
			fixture.detectChanges();
			const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
			expect(fixture.nativeElement.querySelector('.cr-list__row .cr-status').textContent.trim()).toBe(status);
			expect(fixture.nativeElement.querySelector('.cr-detail__header .cr-status').textContent.trim()).toBe(status);
			expect(fixture.nativeElement.querySelector('.cr-actions__approve').disabled).toBe(true);
			expect(fixture.nativeElement.querySelector('.cr-actions__reject-btn')).toBeNull();
		},
	);

	it('refreshes the list for a slow decision on the previous CR without replacing the current detail', async () => {
		const fixture = TestBed.createComponent(AppComponent);
		fixture.detectChanges();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		const api = TestBed.inject(CrApiService);
		api.latencyMs = 100;
		(fixture.nativeElement.querySelector('.cr-actions__approve') as HTMLButtonElement).click();
		api.latencyMs = 0;
		const rows: NodeListOf<HTMLTableRowElement> = fixture.nativeElement.querySelectorAll('.cr-list__row');
		rows[1].click();
		fixture.detectChanges();
		await jest.advanceTimersByTimeAsync(0);
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-detail__header h2').textContent).toContain('Replace SKU-B supplier');
		await jest.runAllTimersAsync();
		fixture.detectChanges();
		expect(fixture.nativeElement.querySelector('.cr-list__row .cr-status').textContent.trim()).toBe('APPROVED');
		expect(fixture.nativeElement.querySelector('.cr-detail__header h2').textContent).toContain('Replace SKU-B supplier');
		expect(fixture.nativeElement.querySelector('.cr-detail__header .cr-status').textContent.trim()).toBe('APPLIED');
	});

	it.each(['approve', 'reject'] as const)(
		'keeps a pending %s locked when returning to its CR, then synchronizes confirmed state',
		async (action) => {
			const fixture = TestBed.createComponent(AppComponent);
			fixture.detectChanges();
			await jest.advanceTimersByTimeAsync(0);
			fixture.detectChanges();
			const api = TestBed.inject(CrApiService);
			const decision = jest.spyOn(api, action);
			const setReason = () => {
				const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('.cr-actions__reason');
				textarea.value = 'Revise pricing';
				textarea.dispatchEvent(new Event('input'));
				fixture.detectChanges();
			};
			if (action === 'reject') setReason();
			api.latencyMs = 100;
			const selector = action === 'approve' ? '.cr-actions__approve' : '.cr-actions__reject-btn';
			(fixture.nativeElement.querySelector(selector) as HTMLButtonElement).click();
			api.latencyMs = 0;
			for (const rowIndex of [1, 0]) {
				(fixture.nativeElement.querySelectorAll('.cr-list__row')[rowIndex] as HTMLTableRowElement).click();
				fixture.detectChanges();
				await jest.advanceTimersByTimeAsync(0);
				fixture.detectChanges();
			}
			if (action === 'reject') setReason();
			const button: HTMLButtonElement = fixture.nativeElement.querySelector(selector);
			expect(button.disabled).toBe(true);
			button.click();
			expect(decision).toHaveBeenCalledTimes(1);
			await jest.runAllTimersAsync();
			fixture.detectChanges();
			const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
			expect(fixture.nativeElement.querySelector('.cr-detail__header .cr-status').textContent.trim()).toBe(status);
			expect(fixture.nativeElement.querySelector('.cr-list__row .cr-status').textContent.trim()).toBe(status);
		},
	);
});

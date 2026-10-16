import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { CrApiService } from '../../api/cr-api.service';
import { SessionService } from '../../session/session.service';
import { CrDetail, ReqUser, TimelineEntry } from '../../models/cr.models';
import { idle, loading, ViewState } from '../../common/view-state';
import { computeDiff, DiffRow } from '../diff.util';
import { formatMoney } from '../../common/money.util';
import { canApprovePolicy } from '../../common/permissions';

/**
 * Change Request DETAIL page: loads a CR and renders the diff/preview, the approval timeline, and
 * permission-aware Approve/Reject actions. `load`, the diff binding, and the template skeleton are
 * provided; the timeline ordering, permission gating, actions, and reject validation are yours.
 */
@Component({
	selector: 'app-cr-detail',
	standalone: true,
	imports: [CommonModule, ReactiveFormsModule],
	templateUrl: './cr-detail.component.html',
})
export class CrDetailComponent implements OnInit, OnChanges, OnDestroy {
	@Input() id!: string;
	@Output() decisionCompleted = new EventEmitter<void>();

	private initialized = false;
	private loadVersion = 0;
	private pendingDecisionIds = new Set<string>();

	ngOnInit(): void {
		this.initialized = true;
		void this.load();
	}

	ngOnChanges(changes: SimpleChanges): void {
		if (this.initialized && changes['id']) {
			void this.load();
		}
	}

	ngOnDestroy(): void {
		this.initialized = false;
		++this.loadVersion;
	}

	state: ViewState<CrDetail> = idle();
	get submitting(): boolean {
		return this.pendingDecisionIds.has(this.id);
	}
	actionError?: string;
	rejectControl = new FormControl('', {
		nonNullable: true,
		validators: [Validators.required, Validators.pattern(/\S/)],
	});

	constructor(private readonly api: CrApiService, private readonly session: SessionService) {}

	async load(): Promise<void> {
		const version = ++this.loadVersion;
		const id = this.id;
		const user = this.session.user;

		this.state = loading();
		this.actionError = undefined;
		this.rejectControl.reset();

		try {
			const detail = await this.api.getChangeRequest(user, id);

			if (version !== this.loadVersion) return;

			this.state = {
				status: 'loaded',
				data: detail,
			};
		} catch (err) {
			if (version !== this.loadVersion) return;

			this.state = {
				status: 'error',
				data: null,
				error: (err as Error).message,
			};
		}
	}

	get detail(): CrDetail | null {
		return this.state.data;
	}

	get diff(): DiffRow[] {
		return this.detail ? computeDiff(this.detail.baselineLineItems, this.detail.proposedLineItems) : [];
	}

	/** Approval timeline, oldest-first. */
	get timeline(): TimelineEntry[] {
		return [...(this.detail?.audit ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	}

	/** Whether the current user may approve the loaded CR. */
	get canApprove(): boolean {
		const cr = this.detail;
		const user = this.session.user;

		return cr !== null && cr.status === 'PENDING_APPROVAL' && cr.orgCode === user.orgCode && canApprovePolicy(user);
	}

	get canReject(): boolean {
		return this.canApprove;
	}

	fmt(amount: number): string {
		return this.detail ? formatMoney(amount, this.detail.currency) : String(amount);
	}

	private isCurrentDecision(id: string, user: ReqUser): boolean {
		return this.initialized && this.id === id && this.session.user === user;
	}

	async approve(): Promise<void> {
		if (!this.canApprove || this.submitting) {
			return;
		}

		// Remember which request this action belongs to
		const requestId = this.id;
		const requestUser = this.session.user;

		this.pendingDecisionIds.add(requestId);
		this.actionError = undefined;

		try {
			const updated = await this.api.approve(requestUser, requestId, new Date().toISOString());

			// A confirmed decision also applies after navigating away and back to this CR.
			if (this.isCurrentDecision(requestId, requestUser)) {
				++this.loadVersion; // Invalidate any read that captured the pre-decision status.
				this.state = {
					status: 'loaded',
					data: updated,
				};
			}

			// Refresh the list after successful approval
			this.decisionCompleted.emit();
		} catch (err) {
			if (this.isCurrentDecision(requestId, requestUser)) {
				this.actionError = (err as Error).message;
			}
		} finally {
			this.pendingDecisionIds.delete(requestId);
		}
	}

	async reject(): Promise<void> {
		this.rejectControl.markAsTouched();

		if (!this.canReject || this.submitting || this.rejectControl.invalid) {
			return;
		}

		const reason = this.rejectControl.value.trim();

		const requestId = this.id;
		const requestUser = this.session.user;

		this.pendingDecisionIds.add(requestId);
		this.actionError = undefined;

		try {
			const updated = await this.api.reject(requestUser, requestId, new Date().toISOString(), reason);

			if (this.isCurrentDecision(requestId, requestUser)) {
				++this.loadVersion;
				this.state = {
					status: 'loaded',
					data: updated,
				};
			}

			this.decisionCompleted.emit();
		} catch (err) {
			if (this.isCurrentDecision(requestId, requestUser)) {
				this.actionError = (err as Error).message;
			}
		} finally {
			this.pendingDecisionIds.delete(requestId);
		}
	}
}

package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const (
	KGCandidateReviewApproved = "approved"
	KGCandidateReviewRejected = "rejected"
)

type KGCandidateReviewInput struct {
	CandidateID  string
	Status       string
	ReviewerID   string
	ReviewerNote string
}

type KGCandidateReview struct {
	ID           int64     `json:"id"`
	CandidateID  string    `json:"candidate_id"`
	Status       string    `json:"status"`
	ReviewerID   string    `json:"reviewer_id"`
	ReviewerNote string    `json:"reviewer_note"`
	ReviewedAt   time.Time `json:"reviewed_at"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (s *SQLiteStore) UpsertKGCandidateReview(ctx context.Context, input KGCandidateReviewInput) (KGCandidateReview, error) {
	input.CandidateID = strings.TrimSpace(input.CandidateID)
	input.Status = strings.TrimSpace(input.Status)
	input.ReviewerID = strings.TrimSpace(input.ReviewerID)
	input.ReviewerNote = strings.TrimSpace(input.ReviewerNote)

	if input.CandidateID == "" {
		return KGCandidateReview{}, fmt.Errorf("candidate id is required")
	}
	if !IsValidKGCandidateReviewStatus(input.Status) {
		return KGCandidateReview{}, fmt.Errorf("invalid KG candidate review status %q", input.Status)
	}
	if input.ReviewerID == "" {
		return KGCandidateReview{}, fmt.Errorf("reviewer id is required")
	}

	now := time.Now().UTC()
	_, err := s.db.ExecContext(
		ctx,
		`insert into kg_candidate_reviews
		   (candidate_id, status, reviewer_id, reviewer_note, reviewed_at, created_at, updated_at)
		 values (?, ?, ?, ?, ?, ?, ?)
		 on conflict(candidate_id) do update set
		   status = excluded.status,
		   reviewer_id = excluded.reviewer_id,
		   reviewer_note = excluded.reviewer_note,
		   reviewed_at = excluded.reviewed_at,
		   updated_at = excluded.updated_at`,
		input.CandidateID,
		input.Status,
		input.ReviewerID,
		input.ReviewerNote,
		formatStoreTime(now),
		formatStoreTime(now),
		formatStoreTime(now),
	)
	if err != nil {
		return KGCandidateReview{}, err
	}

	review, ok, err := s.LatestKGCandidateReview(ctx, input.CandidateID)
	if err != nil {
		return KGCandidateReview{}, err
	}
	if !ok {
		return KGCandidateReview{}, sql.ErrNoRows
	}
	return review, nil
}

func (s *SQLiteStore) ListKGCandidateReviews(ctx context.Context) ([]KGCandidateReview, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`select id, candidate_id, status, reviewer_id, reviewer_note, reviewed_at, created_at, updated_at
		 from kg_candidate_reviews
		 order by reviewed_at desc, id desc`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	reviews := []KGCandidateReview{}
	for rows.Next() {
		review, err := scanKGCandidateReview(rows)
		if err != nil {
			return nil, err
		}
		reviews = append(reviews, review)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return reviews, nil
}

func (s *SQLiteStore) LatestKGCandidateReview(ctx context.Context, candidateID string) (KGCandidateReview, bool, error) {
	row := s.db.QueryRowContext(
		ctx,
		`select id, candidate_id, status, reviewer_id, reviewer_note, reviewed_at, created_at, updated_at
		 from kg_candidate_reviews
		 where candidate_id = ?
		 order by reviewed_at desc, id desc
		 limit 1`,
		strings.TrimSpace(candidateID),
	)
	review, err := scanKGCandidateReview(row)
	if err == sql.ErrNoRows {
		return KGCandidateReview{}, false, nil
	}
	if err != nil {
		return KGCandidateReview{}, false, err
	}
	return review, true, nil
}

func IsValidKGCandidateReviewStatus(status string) bool {
	switch status {
	case KGCandidateReviewApproved, KGCandidateReviewRejected:
		return true
	default:
		return false
	}
}

type kgCandidateReviewScanner interface {
	Scan(dest ...any) error
}

func scanKGCandidateReview(scanner kgCandidateReviewScanner) (KGCandidateReview, error) {
	var review KGCandidateReview
	var reviewedAt string
	var createdAt string
	var updatedAt string
	if err := scanner.Scan(
		&review.ID,
		&review.CandidateID,
		&review.Status,
		&review.ReviewerID,
		&review.ReviewerNote,
		&reviewedAt,
		&createdAt,
		&updatedAt,
	); err != nil {
		return KGCandidateReview{}, err
	}

	parsed, err := parseStoreTime(reviewedAt)
	if err != nil {
		return KGCandidateReview{}, err
	}
	review.ReviewedAt = parsed
	parsed, err = parseStoreTime(createdAt)
	if err != nil {
		return KGCandidateReview{}, err
	}
	review.CreatedAt = parsed
	parsed, err = parseStoreTime(updatedAt)
	if err != nil {
		return KGCandidateReview{}, err
	}
	review.UpdatedAt = parsed
	return review, nil
}

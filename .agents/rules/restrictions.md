# Command Restrictions & Required Confirmations

## 1. Git Commits & Staging
- `git commit` (Do NOT execute `git commit` automatically. Always ask user confirmation to allow manual testing first)
- `git add` (Staging files for commit)

## 2. Git Branch Switching & History Mutation
- `git checkout`
- `git switch`
- `git reset` (hard, soft, or mixed)
- `git merge`
- `git rebase`
- `git branch -d` / `git branch -D`
- `git clean`

## 2. Git Remote & Push Operations
- `git push` (all branches and tags)
- `git remote add`
- `git remote remove` / `rm`
- `git remote set-url`

## 3. Google Cloud Platform (GCP) Operations
- All `gcloud` commands (e.g., `gcloud compute`, `gcloud container`, `gcloud run`, `gcloud auth`)
- All `gsutil` commands (e.g., `gsutil cp`, `gsutil rm`)
- All BigQuery `bq` commands mutating datasets/tables

--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE INDEX "Repo_ix_name" ON "Repo"("name");
CREATE INDEX "Build_ix_repo_id" ON "Build"("repo_id");
CREATE INDEX "Build_ix_status" ON "Build"("status");
CREATE INDEX "Step_ix_build_id_description" ON "Step"("build_id", "description");

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX "Step_ix_build_id_description";
DROP INDEX "Build_ix_status";
DROP INDEX "Build_ix_repo_id";
DROP INDEX "Repo_ix_name";

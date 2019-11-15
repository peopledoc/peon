--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE "Repo" (
  "id" INTEGER PRIMARY KEY,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL
);

CREATE TABLE "Build" (
  "id" INTEGER PRIMARY KEY,
  "repo_id" INTEGER NOT NULL,
  "ref_type" TEXT NOT NULL,
  "ref" TEXT NOT NULL,
  "sha" TEXT NOT NULL,
  "enqueued" INTEGER NOT NULL,
  "updated" INTEGER NOT NULL,
  "start" INTEGER,
  "end" INTEGER,
  "status" TEXT NOT NULL,
  "extra" TEXT,

  CONSTRAINT "Build_fk_repo_id"
    FOREIGN KEY("repo_id") REFERENCES "Repo"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE "Step" (
  "id" INTEGER PRIMARY KEY,
  "build_id" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "start" INTEGER NOT NULL,
  "end" INTEGER,
  "status" TEXT NOT NULL,
  "output" TEXT,

  CONSTRAINT "Step_fk_build_id"
    FOREIGN KEY("build_id") REFERENCES "Build"("id")
    ON UPDATE CASCADE ON DELETE CASCADE
);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP TABLE "Step";
DROP TABLE "Build";
DROP TABLE "Repo";

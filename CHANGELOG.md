# Changelog

## [0.0.1](https://github.com/hileix/dev-workflow/compare/dev-workflow-v0.0.1...dev-workflow-v0.0.1) (2026-05-31)


### ⚠ BREAKING CHANGES

* **workflow:** Existing unfinished runs without a workflowDefinition snapshot may not resume reliably, and workflows with invalid step_output references or unsafe filenames are now rejected.

### Features

* add desktop instance workflow ([#21](https://github.com/hileix/dev-workflow/issues/21)) ([09fa5cf](https://github.com/hileix/dev-workflow/commit/09fa5cf5ac91e665a854545d5942c6c6cd52ecb4))
* add system theme option to theme toggle ([#27](https://github.com/hileix/dev-workflow/issues/27)) ([70b6a0d](https://github.com/hileix/dev-workflow/commit/70b6a0d7f7b3aa3ff088a912ff17a2719ed26611))
* **workflow:** add default workflows and visibility controls ([#10](https://github.com/hileix/dev-workflow/issues/10)) ([a19c7fe](https://github.com/hileix/dev-workflow/commit/a19c7fec67412733256759f5f8c4d35225870311))
* **workflow:** persist run-specific langgraph state ([#7](https://github.com/hileix/dev-workflow/issues/7)) ([9b3756a](https://github.com/hileix/dev-workflow/commit/9b3756a1ddcfd7bbb80f14f53887895cdc89b024))
* **workflow:** support pasted task images ([#14](https://github.com/hileix/dev-workflow/issues/14)) ([32a1d77](https://github.com/hileix/dev-workflow/commit/32a1d7733a3bc23f1386d34ea80cdfea6e518958))


### Bug Fixes

* issues ([#16](https://github.com/hileix/dev-workflow/issues/16)) ([21c977c](https://github.com/hileix/dev-workflow/commit/21c977c07321b61cf27f1c9dc731e73bf38b4cff))
* merge system and user settings data ([#28](https://github.com/hileix/dev-workflow/issues/28)) ([9c5a5cc](https://github.com/hileix/dev-workflow/commit/9c5a5cc336a240a35dfac67d9e9836abedb046f9))
* share workflow run state across pages ([#15](https://github.com/hileix/dev-workflow/issues/15)) ([75506f9](https://github.com/hileix/dev-workflow/commit/75506f9ff4d995d8d19e79659bda009f65d56f43))
* use shared settings directory for all instances ([#29](https://github.com/hileix/dev-workflow/issues/29)) ([d9dba5c](https://github.com/hileix/dev-workflow/commit/d9dba5c46d1205e2ae2b4ccba459d24e75289cd3))
* **workflow:** keep AI loading indicator visible ([#12](https://github.com/hileix/dev-workflow/issues/12)) ([73d73ac](https://github.com/hileix/dev-workflow/commit/73d73ac27bb9632786e2473e10a8b46c62bca1d6))

## [0.0.1](https://github.com/hileix/dev-workflow/compare/dev-workflow-v0.0.1...dev-workflow-v0.0.1) (2026-05-12)


### ⚠ BREAKING CHANGES

* **workflow:** Existing unfinished runs without a workflowDefinition snapshot may not resume reliably, and workflows with invalid step_output references or unsafe filenames are now rejected.

### Features

* **workflow:** add default workflows and visibility controls ([#10](https://github.com/hileix/dev-workflow/issues/10)) ([a19c7fe](https://github.com/hileix/dev-workflow/commit/a19c7fec67412733256759f5f8c4d35225870311))
* **workflow:** persist run-specific langgraph state ([#7](https://github.com/hileix/dev-workflow/issues/7)) ([9b3756a](https://github.com/hileix/dev-workflow/commit/9b3756a1ddcfd7bbb80f14f53887895cdc89b024))

## [0.0.1](https://github.com/hileix/dev-workflow/compare/dev-workflow-v0.0.1...dev-workflow-v0.0.1) (2026-05-11)


### ⚠ BREAKING CHANGES

* **workflow:** Existing unfinished runs without a workflowDefinition snapshot may not resume reliably, and workflows with invalid step_output references or unsafe filenames are now rejected.

### Features

* **workflow:** persist run-specific langgraph state ([#7](https://github.com/hileix/dev-workflow/issues/7)) ([9b3756a](https://github.com/hileix/dev-workflow/commit/9b3756a1ddcfd7bbb80f14f53887895cdc89b024))

## 0.0.1 (2026-05-11)


### Features

* add app-managed skills system ([8dd48c0](https://github.com/hileix/dev-workflow/commit/8dd48c0b1e088111bc2330f2668ab089be818815))
* add mobile and backend, use mono repo ([b0aec05](https://github.com/hileix/dev-workflow/commit/b0aec05a725e6197fd15d9b1803da817e2c1e4e9))
* add Select component for improved UI consistency ([e587792](https://github.com/hileix/dev-workflow/commit/e587792fa7079f901cc95dcc134be78cf6fee808))
* add superpowers development workflow configuration ([d22c823](https://github.com/hileix/dev-workflow/commit/d22c82378931fe0a59c4ba769eaca848736251c7))
* add support for handling task output documents and improve error messaging ([f70e28c](https://github.com/hileix/dev-workflow/commit/f70e28c47e3557d91d68506fa14a9d92aed3a528))
* add workflow worktree support ([40bf238](https://github.com/hileix/dev-workflow/commit/40bf2385e3314ea50d32e3d124454d097cb33325))
* add WorkflowDebugPanel for enhanced debugging and event tracking ([1a98e31](https://github.com/hileix/dev-workflow/commit/1a98e3143ade9fa2fcb1beff43eeee7b7c019689))
* **desktop:** refresh shell layout and move app data ([220a0b0](https://github.com/hileix/dev-workflow/commit/220a0b0b7f8afe9d512eef7b57981f094d745228))
* enhance conversation handling in StepDetail component ([ce8e8ad](https://github.com/hileix/dev-workflow/commit/ce8e8addded91eeb6030858fa7997edb0e4d2a7f))
* enhance task deletion process with improved routing and user feedback ([aca89e5](https://github.com/hileix/dev-workflow/commit/aca89e5f22914a41a50d9869b7f5ea965d574f3c))
* enhance task deletion with optional worktree removal ([a54753c](https://github.com/hileix/dev-workflow/commit/a54753c4b0396d945877005bb5544a7ca922ee29))
* implement worktree name generation and handling in workflow processes ([8ddf32d](https://github.com/hileix/dev-workflow/commit/8ddf32ddd78b14a23aa965dcddefb55abc802f0d))
* sync desktop and mobile workflow stack ([ae3bb4e](https://github.com/hileix/dev-workflow/commit/ae3bb4e063f12cbfe89230c97c739f240491d021))


### Bug Fixes

* improve error handling in configStore for skill saving ([e587792](https://github.com/hileix/dev-workflow/commit/e587792fa7079f901cc95dcc134be78cf6fee808))
* update workflow JSON to include skills and correct action labels ([e587792](https://github.com/hileix/dev-workflow/commit/e587792fa7079f901cc95dcc134be78cf6fee808))
* update WorkflowFlowchart to use correct action label for rejection ([e587792](https://github.com/hileix/dev-workflow/commit/e587792fa7079f901cc95dcc134be78cf6fee808))

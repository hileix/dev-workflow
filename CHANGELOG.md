# Changelog

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

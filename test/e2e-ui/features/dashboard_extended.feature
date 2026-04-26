Feature: Dashboard Extended
  Extended dashboard scenarios including empty state, validation, and mobile.

  Scenario: Dashboard shows empty state when no sessions
    Given all test sessions are cleaned up
    And I am on the dashboard
    Then I should see the empty state message

  Scenario: Create session shows validation for invalid workdir
    Given I am on the dashboard
    When I click the new session button
    And I enter manual workdir "/nonexistent/path/e2e-test-xyz"
    And I enter session name "e2e-validation-test" in the create modal
    Then the create button should be disabled or show directory not found

  Scenario: Create session by typing an absolute path into the search
    Given I am on the dashboard
    When I click the new session button
    And I type the test-repo-2 absolute path into the directory search
    Then the typed path should appear as a selectable result
    When I select the typed path result
    And I enter session name "e2e-abs-path" in the create modal
    And I submit the create session form
    Then I should be on the session page for "e2e-abs-path"
    And the "e2e-abs-path" session is cleaned up

  Scenario: Typing a nonexistent absolute path shows an error
    Given I am on the dashboard
    When I click the new session button
    And I type absolute path "/nonexistent/path/e2e-abs-missing" into the directory search
    Then the directory search should show a path-does-not-exist error
    And the create button should be disabled

  Scenario: Dashboard is usable on mobile viewport
    Given I am on the dashboard with mobile viewport
    And a test session exists
    Then I should see the session card for "e2e-ui-session"
    And the page should not have horizontal scroll

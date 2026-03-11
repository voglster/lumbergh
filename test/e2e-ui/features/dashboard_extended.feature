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

  Scenario: Dashboard is usable on mobile viewport
    Given I am on the dashboard with mobile viewport
    And a test session exists
    Then I should see the session card for "e2e-ui-session"
    And the page should not have horizontal scroll

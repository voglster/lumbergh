Feature: Dashboard
  As a user I want to see and manage my sessions from the dashboard.

  Scenario: Dashboard shows active sessions
    Given I am on the dashboard
    And a test session exists
    Then I should see the session card for "e2e-ui-session"

  Scenario: Create a new session
    Given I am on the dashboard
    When I click the new session button
    Then I should see the create session modal
    When I enter the test-repo-2 workdir in the create modal
    And I enter session name "e2e-ui-created" in the create modal
    And I submit the create session form
    Then I should be on the session page for "e2e-ui-created"

  Scenario: Delete a session
    Given I am on the dashboard
    And a session "e2e-ui-created" exists
    When I delete the session "e2e-ui-created"
    Then I should not see the session card for "e2e-ui-created"

Feature: Session Terminal
  As a user I want to view and interact with a terminal session.

  Scenario: Navigate to session and see terminal
    Given I am on the dashboard
    And a test session exists
    When I click on the session "e2e-ui-session"
    Then I should see the terminal container
    And I should see the xterm terminal

  Scenario: Tab navigation works
    Given I am on the session page for "e2e-ui-session"
    When I click the "git" tab
    Then I should see the git tab content
    When I click the "todo" tab
    Then I should see the todo input

  Scenario: Wheeling a plain shell pane does not inject page keys
    Given a test session exists
    And I am on the dashboard
    When I record terminal websocket frames
    And I click on the session "e2e-ui-session"
    And I scroll the terminal with the wheel
    Then no page-key escape sequences are sent to the session

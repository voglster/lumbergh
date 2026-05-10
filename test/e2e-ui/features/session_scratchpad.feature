Feature: Session Scratchpad
  As a user I want to write notes in the scratchpad for my session.

  Scenario: Write and read scratchpad content
    Given I am on the session page for "e2e-ui-session"
    When I click the "todo" tab
    And I type "# E2E Test Notes" in the scratchpad
    Then the scratchpad should contain "# E2E Test Notes"

  Scenario: Scratchpad content is isolated between sessions
    Given I am on the session page for "e2e-ui-session"
    And a second test session exists
    When I click the "todo" tab
    And I type "Notes for session 1" in the scratchpad
    And I navigate to the session page for "e2e-ui-session-2"
    And I click the "todo" tab
    Then the scratchpad should not contain "Notes for session 1"

  Scenario: Stale scratchpad fetch from previous session does not poison the next
    Given a second test session exists
    And session "e2e-ui-session" has scratchpad content "POISON_FROM_SESSION_A"
    And session "e2e-ui-session-2" has scratchpad content "session-2-clean"
    And the scratchpad GET for "e2e-ui-session" is delayed by 2500 ms
    When I open the session page for "e2e-ui-session" without waiting
    And I click the "todo" tab without waiting
    And I switch in-app to the session page for "e2e-ui-session-2"
    And I click the "todo" tab
    And I wait 3500 ms
    Then the scratchpad should not contain "POISON_FROM_SESSION_A"
    And session "e2e-ui-session-2" backend scratchpad should not contain "POISON_FROM_SESSION_A"

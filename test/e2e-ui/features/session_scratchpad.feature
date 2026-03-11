Feature: Session Scratchpad
  As a user I want to write notes in the scratchpad for my session.

  Scenario: Write and read scratchpad content
    Given I am on the session page for "e2e-ui-session"
    When I click the "todo" tab
    And I type "# E2E Test Notes" in the scratchpad
    Then the scratchpad should contain "# E2E Test Notes"

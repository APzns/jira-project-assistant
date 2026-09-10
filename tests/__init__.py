import os

# Globally enable testing mode to bypass live external LLM API calls during unit tests.
os.environ["TESTING"] = "true"

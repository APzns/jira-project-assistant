terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = "jira-ai-503005"
  region  = "europe-west3"
}

locals {
  project_id = "jira-ai-503005"
  region     = "europe-west3"
  service    = "jira-ai"
}

resource "google_cloud_run_v2_service" "jira_ai" {
  name     = local.service
  location = local.region

  # Keep deletion protection on; Basic Auth inside the app gates public access.
  deletion_protection = true

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    containers {
      # Placeholder — the real image is built and pushed by
      # `gcloud run deploy --source .`. Terraform ignores changes to
      # this field (see lifecycle block below).
      image = "europe-west3-docker.pkg.dev/jira-ai-503005/cloud-run-source-deploy/jira-ai:latest"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1000m"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "SHOW_SQL"
        value = "false"
      }

      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = "GEMINI_API_KEY"
            version = "latest"
          }
        }
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = "DATABASE_URL"
            version = "latest"
          }
        }
      }

      env {
        name = "BASIC_AUTH_USER"
        value_source {
          secret_key_ref {
            secret  = "BASIC_AUTH_USER"
            version = "latest"
          }
        }
      }

      env {
        name = "BASIC_AUTH_PASS"
        value_source {
          secret_key_ref {
            secret  = "BASIC_AUTH_PASS"
            version = "latest"
          }
        }
      }
    }
  }

  # The container image and build metadata are managed by
  # `gcloud run deploy --source .`, not Terraform. Ignoring these
  # prevents Terraform from reverting your app deploys.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      build_config,
      client,
      client_version,
      scaling,
    ]
  }

}

# Make the service publicly reachable (Basic Auth is the gate).
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.jira_ai.name
  location = google_cloud_run_v2_service.jira_ai.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "service_url" {
  value = google_cloud_run_v2_service.jira_ai.uri
}

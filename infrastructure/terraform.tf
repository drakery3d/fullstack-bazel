terraform {
  required_version = "~> 0.14.8"
  required_providers {
    google           = "~> 3.60"
    kubernetes       = "~> 2.0.3"
    helm             = "~> 2.0.3"
    kubernetes-alpha = "~> 0.3.2"
    random           = "~> 3.1.0"
    aws              = "~> 3.33.0"
  }
}

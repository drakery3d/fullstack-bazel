terraform {
  backend "gcs" {
    bucket = "fullbazel-terraform-state"
    prefix = "prod"
  }
}

module "sql" {
  source  = "./modules/cloudsql"
  project = var.gcp_project_id
}

module "gke" {
  source       = "./modules/gke"
  project      = var.gcp_project_id
  region       = var.gke_region
  node_count   = var.gke_node_count
  preemptible  = var.gke_preemptible
  disk_size_gb = var.gke_disk_size_gb
  machine_type = var.gke_machine_type
}

module "kafka" {
  source = "./modules/kafka"
}

module "ingress" {
  source = "./modules/k8s-ingress"
  domain = var.domain
}

module "cert-manager" {
  source = "./modules/k8s-cert-manager"
}

module "dns" {
  source  = "./modules/dns"
  ip      = module.ingress.ip
  zone_id = var.aws_zone_id
  domain  = var.domain
}

locals {
  environment   = "prod"
  api_url       = "https://api.${var.domain}"
  websocket_url = "wss://api.${var.domain}"
  client_url    = "https://${var.domain}"
}

module "configuration" {
  source                       = "./modules/k8s-config"
  environment                  = local.environment
  api_url                      = local.api_url
  websocket_url                = local.websocket_url
  client_url                   = local.client_url
  auth_token_secret            = var.auth_token_secret
  web_push_vapid_public_key    = var.web_push_vapid_public_key
  web_push_vapid_private_key   = var.web_push_vapid_private_key
  google_sign_in_client_id     = var.google_sign_in_client_id
  google_sign_in_client_secret = var.google_sign_in_client_secret
  cloudsql_instance            = module.sql.instance
  mysql_host                   = "127.0.0.1"
  mysql_port                   = "3306"
  mysql_user                   = module.sql.user
  mysql_database               = module.sql.database
  mysql_password               = module.sql.password
  kafka_seed_broker            = module.kafka.seed_broker
}

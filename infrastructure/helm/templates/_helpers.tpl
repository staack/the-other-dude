{{/*
Expand the name of the chart.
*/}}
{{- define "mikrotik-portal.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "mikrotik-portal.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "mikrotik-portal.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources.
*/}}
{{- define "mikrotik-portal.labels" -}}
helm.sh/chart: {{ include "mikrotik-portal.chart" . }}
{{ include "mikrotik-portal.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — used in Deployments/Services to match pods.
*/}}
{{- define "mikrotik-portal.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mikrotik-portal.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
API component labels
*/}}
{{- define "mikrotik-portal.apiLabels" -}}
{{ include "mikrotik-portal.labels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
API selector labels
*/}}
{{- define "mikrotik-portal.apiSelectorLabels" -}}
{{ include "mikrotik-portal.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Frontend component labels
*/}}
{{- define "mikrotik-portal.frontendLabels" -}}
{{ include "mikrotik-portal.labels" . }}
app.kubernetes.io/component: frontend
{{- end }}

{{/*
Frontend selector labels
*/}}
{{- define "mikrotik-portal.frontendSelectorLabels" -}}
{{ include "mikrotik-portal.selectorLabels" . }}
app.kubernetes.io/component: frontend
{{- end }}

{{/*
PostgreSQL component labels
*/}}
{{- define "mikrotik-portal.postgresLabels" -}}
{{ include "mikrotik-portal.labels" . }}
app.kubernetes.io/component: postgres
{{- end }}

{{/*
PostgreSQL selector labels
*/}}
{{- define "mikrotik-portal.postgresSelectorLabels" -}}
{{ include "mikrotik-portal.selectorLabels" . }}
app.kubernetes.io/component: postgres
{{- end }}

{{/*
Redis component labels
*/}}
{{- define "mikrotik-portal.redisLabels" -}}
{{ include "mikrotik-portal.labels" . }}
app.kubernetes.io/component: redis
{{- end }}

{{/*
Redis selector labels
*/}}
{{- define "mikrotik-portal.redisSelectorLabels" -}}
{{ include "mikrotik-portal.selectorLabels" . }}
app.kubernetes.io/component: redis
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "mikrotik-portal.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "mikrotik-portal.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Database URL for the API service (constructed from service names).
Uses external URL if postgres.enabled=false.
*/}}
{{- define "mikrotik-portal.databaseUrl" -}}
{{- if .Values.postgres.enabled }}
{{- printf "postgresql+asyncpg://%s:%s@%s-postgres:%d/%s" .Values.postgres.auth.username .Values.secrets.dbPassword (include "mikrotik-portal.fullname" .) (int .Values.postgres.service.port) .Values.postgres.auth.database }}
{{- else }}
{{- .Values.postgres.externalUrl }}
{{- end }}
{{- end }}

{{/*
App user database URL (RLS enforced).
*/}}
{{- define "mikrotik-portal.appUserDatabaseUrl" -}}
{{- if .Values.postgres.enabled }}
{{- printf "postgresql+asyncpg://%s:%s@%s-postgres:%d/%s" .Values.postgres.auth.appUsername .Values.secrets.dbAppPassword (include "mikrotik-portal.fullname" .) (int .Values.postgres.service.port) .Values.postgres.auth.database }}
{{- else }}
{{- .Values.postgres.externalUrl }}
{{- end }}
{{- end }}

{{/*
Sync database URL for Alembic migrations.
*/}}
{{- define "mikrotik-portal.syncDatabaseUrl" -}}
{{- if .Values.postgres.enabled }}
{{- printf "postgresql+psycopg2://%s:%s@%s-postgres:%d/%s" .Values.postgres.auth.username .Values.secrets.dbPassword (include "mikrotik-portal.fullname" .) (int .Values.postgres.service.port) .Values.postgres.auth.database }}
{{- else }}
{{- .Values.postgres.externalUrl | replace "asyncpg" "psycopg2" }}
{{- end }}
{{- end }}

{{/*
Redis URL (constructed from service name).
*/}}
{{- define "mikrotik-portal.redisUrl" -}}
{{- if .Values.redis.enabled }}
{{- printf "redis://%s-redis:%d/0" (include "mikrotik-portal.fullname" .) (int .Values.redis.service.port) }}
{{- else }}
{{- .Values.redis.externalUrl | default "redis://localhost:6379/0" }}
{{- end }}
{{- end }}

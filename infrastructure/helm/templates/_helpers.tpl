{{/*
Expand the name of the chart.
*/}}
{{- define "the-other-dude.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "the-other-dude.fullname" -}}
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
{{- define "the-other-dude.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources.
*/}}
{{- define "the-other-dude.labels" -}}
helm.sh/chart: {{ include "the-other-dude.chart" . }}
{{ include "the-other-dude.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — used in Deployments/Services to match pods.
*/}}
{{- define "the-other-dude.selectorLabels" -}}
app.kubernetes.io/name: {{ include "the-other-dude.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
API component labels
*/}}
{{- define "the-other-dude.apiLabels" -}}
{{ include "the-other-dude.labels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
API selector labels
*/}}
{{- define "the-other-dude.apiSelectorLabels" -}}
{{ include "the-other-dude.selectorLabels" . }}
app.kubernetes.io/component: api
{{- end }}

{{/*
Frontend component labels
*/}}
{{- define "the-other-dude.frontendLabels" -}}
{{ include "the-other-dude.labels" . }}
app.kubernetes.io/component: frontend
{{- end }}

{{/*
Frontend selector labels
*/}}
{{- define "the-other-dude.frontendSelectorLabels" -}}
{{ include "the-other-dude.selectorLabels" . }}
app.kubernetes.io/component: frontend
{{- end }}

{{/*
PostgreSQL component labels
*/}}
{{- define "the-other-dude.postgresLabels" -}}
{{ include "the-other-dude.labels" . }}
app.kubernetes.io/component: postgres
{{- end }}

{{/*
PostgreSQL selector labels
*/}}
{{- define "the-other-dude.postgresSelectorLabels" -}}
{{ include "the-other-dude.selectorLabels" . }}
app.kubernetes.io/component: postgres
{{- end }}

{{/*
Redis component labels
*/}}
{{- define "the-other-dude.redisLabels" -}}
{{ include "the-other-dude.labels" . }}
app.kubernetes.io/component: redis
{{- end }}

{{/*
Redis selector labels
*/}}
{{- define "the-other-dude.redisSelectorLabels" -}}
{{ include "the-other-dude.selectorLabels" . }}
app.kubernetes.io/component: redis
{{- end }}

{{/*
Create the name of the service account to use.
*/}}
{{- define "the-other-dude.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "the-other-dude.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Database URL for the API service (constructed from service names).
Uses external URL if postgres.enabled=false.
*/}}
{{- define "the-other-dude.databaseUrl" -}}
{{- if .Values.postgres.enabled }}
{{- printf "postgresql+asyncpg://%s:%s@%s-postgres:%d/%s" .Values.postgres.auth.username .Values.secrets.dbPassword (include "the-other-dude.fullname" .) (int .Values.postgres.service.port) .Values.postgres.auth.database }}
{{- else }}
{{- .Values.postgres.externalUrl }}
{{- end }}
{{- end }}

{{/*
App user database URL (RLS enforced).
*/}}
{{- define "the-other-dude.appUserDatabaseUrl" -}}
{{- if .Values.postgres.enabled }}
{{- printf "postgresql+asyncpg://%s:%s@%s-postgres:%d/%s" .Values.postgres.auth.appUsername .Values.secrets.dbAppPassword (include "the-other-dude.fullname" .) (int .Values.postgres.service.port) .Values.postgres.auth.database }}
{{- else }}
{{- .Values.postgres.externalUrl }}
{{- end }}
{{- end }}

{{/*
Sync database URL for Alembic migrations.
*/}}
{{- define "the-other-dude.syncDatabaseUrl" -}}
{{- if .Values.postgres.enabled }}
{{- printf "postgresql+psycopg2://%s:%s@%s-postgres:%d/%s" .Values.postgres.auth.username .Values.secrets.dbPassword (include "the-other-dude.fullname" .) (int .Values.postgres.service.port) .Values.postgres.auth.database }}
{{- else }}
{{- .Values.postgres.externalUrl | replace "asyncpg" "psycopg2" }}
{{- end }}
{{- end }}

{{/*
Redis URL (constructed from service name).
*/}}
{{- define "the-other-dude.redisUrl" -}}
{{- if .Values.redis.enabled }}
{{- printf "redis://%s-redis:%d/0" (include "the-other-dude.fullname" .) (int .Values.redis.service.port) }}
{{- else }}
{{- .Values.redis.externalUrl | default "redis://localhost:6379/0" }}
{{- end }}
{{- end }}

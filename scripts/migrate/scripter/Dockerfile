# mssql-scripter (pre-release only) bundles a .NET Core 2.x service that needs OpenSSL 1.0 and an old
# ICU; neither exists on ubuntu-latest or current Debian. Ubuntu 18.04 still ships both.
# Built and run by scripts/migrate/sync.sh, the same way locally and on the runner. Holds no data.
# APT::Sandbox::User=root: apt's unprivileged _apt user cannot verify signatures under some docker
# runtimes (colima), failing every repo as "not signed". The build only fetches signed Ubuntu debs.
FROM ubuntu:18.04
ENV DEBIAN_FRONTEND=noninteractive LC_ALL=C.UTF-8 LANG=C.UTF-8 PYTHONIOENCODING=utf8
RUN apt-get -o APT::Sandbox::User=root update \
 && apt-get -o APT::Sandbox::User=root install -y --no-install-recommends python3 python3-pip python3-setuptools ca-certificates libssl1.0.0 libicu60 libunwind8 libcurl4 \
 && pip3 install --pre mssql-scripter \
 && rm -rf /var/lib/apt/lists/*

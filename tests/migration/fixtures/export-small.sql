USE [TechAssoc]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
INSERT [dbo].[tblstates] ([state]) VALUES (N'NJ'), (N'NY'), (N'PA')
GO
INSERT [dbo].[tblbranches] ([branch]) VALUES (N'Newark')
INSERT [dbo].[tblbranches] ([branch]) VALUES (N'Trenton')
INSERT [dbo].[tblbranches] ([branch]) VALUES (N'Camden')
GO
INSERT [dbo].[tblcasestatus] ([casestatus]) VALUES (N'Open')
INSERT [dbo].[tblcasestatus] ([casestatus]) VALUES (N'Closed')
INSERT [dbo].[tblcasestatus] ([casestatus]) VALUES (N'Pending')
GO
INSERT [dbo].[tblcasepriority] ([priority]) VALUES (N'High')
INSERT [dbo].[tblcasepriority] ([priority]) VALUES (N'Medium')
INSERT [dbo].[tblcasepriority] ([priority]) VALUES (N'Low')
GO
INSERT [dbo].[tblcasewaitingfor] ([waitingfor]) VALUES (N'Client')
INSERT [dbo].[tblcasewaitingfor] ([waitingfor]) VALUES (N'Court')
INSERT [dbo].[tblcasewaitingfor] ([waitingfor]) VALUES (N'Report')
GO
SET IDENTITY_INSERT [dbo].[tblbillingnames] ON
INSERT [dbo].[tblbillingnames] ([personid], [initials], [billingfactor]) VALUES (11, N'AA', CAST(1.000 AS Decimal(8, 3)))
INSERT [dbo].[tblbillingnames] ([personid], [initials], [billingfactor]) VALUES (12, N'BB', CAST(1.500 AS Decimal(8, 3)))
INSERT [dbo].[tblbillingnames] ([personid], [initials], [billingfactor]) VALUES (13, N'CC', CAST(0.750 AS Decimal(8, 3)))
SET IDENTITY_INSERT [dbo].[tblbillingnames] OFF
GO
SET IDENTITY_INSERT [dbo].[tblexptype] ON
INSERT [dbo].[tblexptype] ([exptypeid], [exptype], [active]) VALUES (21, N'Travel', 1)
INSERT [dbo].[tblexptype] ([exptypeid], [exptype], [active]) VALUES (22, N'Copies', 0)
INSERT [dbo].[tblexptype] ([exptypeid], [exptype], [active]) VALUES (23, N'Filing', 0)
SET IDENTITY_INSERT [dbo].[tblexptype] OFF
GO
SET IDENTITY_INSERT [dbo].[tblfirm] ON
INSERT [dbo].[tblfirm] ([frmid], [frmname], [frmcity], [frmstate], [frmactive]) VALUES (31, N'Alpha LLP', N'Newark', N'NJ', N'Yes')
INSERT [dbo].[tblfirm] ([frmid], [frmname], [frmcity], [frmstate], [frmactive]) VALUES (32, N'Beta PC', N'Albany', N'NY', N'Yes')
INSERT [dbo].[tblfirm] ([frmid], [frmname], [frmcity], [frmstate], [frmactive]) VALUES (33, N'Gamma & Sons', NULL, N'PA', N'No')
SET IDENTITY_INSERT [dbo].[tblfirm] OFF
GO
SET IDENTITY_INSERT [dbo].[tblattorney] ON
INSERT [dbo].[tblattorney] ([attyid], [attyfirmid], [attyfirstname], [attylastname], [attyesq]) VALUES (41, 31, N'Ann', N'Smith', 1)
INSERT [dbo].[tblattorney] ([attyid], [attyfirmid], [attyfirstname], [attylastname], [attyesq]) VALUES (42, 32, N'Bob', N'Jones', 0)
INSERT [dbo].[tblattorney] ([attyid], [attyfirmid], [attyfirstname], [attylastname], [attyesq]) VALUES (43, 33, N'Cy', N'Lee', 0)
SET IDENTITY_INSERT [dbo].[tblattorney] OFF
GO
SET IDENTITY_INSERT [dbo].[tblclient] ON
INSERT [dbo].[tblclient] ([clientid], [clientfirstname], [clientlastname], [clientnotes]) VALUES (51, N'Dana', N'Reyes', N'prefers email')
INSERT [dbo].[tblclient] ([clientid], [clientfirstname], [clientlastname], [clientnotes]) VALUES (52, N'Evan', N'Cole', NULL)
INSERT [dbo].[tblclient] ([clientid], [clientfirstname], [clientlastname], [clientnotes]) VALUES (53, N'Fay', N'Okonkwo', N'')
SET IDENTITY_INSERT [dbo].[tblclient] OFF
GO
SET IDENTITY_INSERT [dbo].[tblinquiry] ON
INSERT [dbo].[tblinquiry] ([id], [inqdate], [inqtime], [inqattyid], [inqdescription], [sentfee]) VALUES (61, CAST(N'2018-11-02' AS Date), CAST(N'23:30:00.0000000' AS Time), 41, N'first call', 1)
INSERT [dbo].[tblinquiry] ([id], [inqdate], [inqtime], [inqattyid], [inqdescription], [sentfee]) VALUES (62, CAST(N'2019-01-15' AS Date), NULL, 42, NULL, 0)
INSERT [dbo].[tblinquiry] ([id], [inqdate], [inqtime], [inqattyid], [inqdescription], [sentfee]) VALUES (63, CAST(N'2019-06-30' AS Date), CAST(N'1899-12-30T08:05:00.0000000' AS DateTime2), 43, N'referral', 0)
SET IDENTITY_INSERT [dbo].[tblinquiry] OFF
GO
SET IDENTITY_INSERT [dbo].[tblcase] ON
INSERT [dbo].[tblcase] ([caseid], [caseatty], [casetitle], [caseclient], [tabranch], [status], [casestartdate], [casenotes], [casestatlastupdated], [billingalert], [numunpaidbills], [numunapprovedsa]) VALUES (5001, 41, N'Rowe v. Diaz', 51, N'Newark', N'Open', CAST(N'2019-02-01' AS Date), N'Line one; semicolon kept
it''s line two', CAST(N'2021-07-04T08:15:30.1234567' AS DateTime2), 1, 7, 0)
INSERT [dbo].[tblcase] ([caseid], [caseatty], [casetitle], [caseclient], [tabranch], [status], [casestartdate], [casenotes], [casestatlastupdated], [billingalert], [numunpaidbills], [numunapprovedsa]) VALUES (5002, 42, N'Hale v. Torres', 52, N'Trenton', N'Closed', CAST(N'2019-05-20' AS Date), NULL, NULL, 0, 1, 1)
INSERT [dbo].[tblcase] ([caseid], [caseatty], [casetitle], [caseclient], [tabranch], [status], [casestartdate], [casenotes], [casestatlastupdated], [billingalert], [numunpaidbills], [numunapprovedsa]) VALUES (5010, 43, N'Iyer v. Novak', 53, N'Camden', N'Pending', CAST(N'2020-08-11' AS Date), N'short note', NULL, 0, NULL, 4)
SET IDENTITY_INSERT [dbo].[tblcase] OFF
GO
SET IDENTITY_INSERT [dbo].[tblbills] ON
INSERT [dbo].[tblbills] ([billid], [billcaseid], [billdate], [billhours], [billbalance], [billnotice], [billestimate]) VALUES (71, 5001, CAST(N'2019-03-05T23:30:00.000' AS DateTime), CAST(3.50 AS Decimal(8, 2)), CAST(1200.00 AS Decimal(12, 2)), N'first', 0)
INSERT [dbo].[tblbills] ([billid], [billcaseid], [billdate], [billhours], [billbalance], [billnotice], [billestimate]) VALUES (72, 5002, CAST(N'2019-09-12T00:00:00.000' AS DateTime), CAST(1.25 AS Decimal(8, 2)), CAST(0.00 AS Decimal(12, 2)), N'paid', 1)
INSERT [dbo].[tblbills] ([billid], [billcaseid], [billdate], [billhours], [billbalance], [billnotice], [billestimate]) VALUES (73, 5010, CAST(N'2020-10-01T00:00:00.000' AS DateTime), CAST(0.00 AS Decimal(8, 2)), CAST(45.60 AS Decimal(12, 2)), N'second', 0)
SET IDENTITY_INSERT [dbo].[tblbills] OFF
GO
SET IDENTITY_INSERT [dbo].[tblactivity] ON
INSERT [dbo].[tblactivity] ([actid], [actcaseid], [actdate], [actdescription], [acthrs], [actwho], [actbilled]) VALUES (81, 5001, CAST(N'2019-02-10' AS Date), N'review file', CAST(2.00 AS Decimal(8, 2)), 11, 1)
INSERT [dbo].[tblactivity] ([actid], [actcaseid], [actdate], [actdescription], [acthrs], [actwho], [actbilled]) VALUES (82, 5002, CAST(N'2019-06-01' AS Date), N'site visit', CAST(4.25 AS Decimal(8, 2)), 12, 0)
INSERT [dbo].[tblactivity] ([actid], [actcaseid], [actdate], [actdescription], [acthrs], [actwho], [actbilled]) VALUES (83, 5010, CAST(N'2020-09-09' AS Date), N'phone call', CAST(0.50 AS Decimal(8, 2)), NULL, 0)
SET IDENTITY_INSERT [dbo].[tblactivity] OFF
GO
SET IDENTITY_INSERT [dbo].[tblexpenses] ON
INSERT [dbo].[tblexpenses] ([expid], [expcaseid], [expdate], [expdscr], [expchecknum], [exptype], [expamount], [expinit], [expclearedbank]) VALUES (91, 5001, CAST(N'2019-03-01' AS Date), N'mileage', 1001, 21, CAST(87.40 AS Money), 11, 1)
INSERT [dbo].[tblexpenses] ([expid], [expcaseid], [expdate], [expdscr], [expchecknum], [exptype], [expamount], [expinit], [expclearedbank]) VALUES (92, 5002, CAST(N'2019-07-18' AS Date), N'copies', 1002, 22, CAST(12.00 AS Money), 12, 0)
INSERT [dbo].[tblexpenses] ([expid], [expcaseid], [expdate], [expdscr], [expchecknum], [exptype], [expamount], [expinit], [expclearedbank]) VALUES (93, 999999, CAST(N'2020-11-30' AS Date), N'orphan expense', 1003, 23, CAST(5.05 AS Money), NULL, 0)
SET IDENTITY_INSERT [dbo].[tblexpenses] OFF
GO
SET IDENTITY_INSERT [dbo].[tblfundsrcvd] ON
INSERT [dbo].[tblfundsrcvd] ([fndsid], [fndscaseid], [fndsdate], [fndspmt], [fndsbranch], [fndscomment], [fndsclearedbank]) VALUES (101, 5001, CAST(N'2019-04-01' AS Date), CAST(500.00 AS Money), N'Newark', N'retainer', 1)
INSERT [dbo].[tblfundsrcvd] ([fndsid], [fndscaseid], [fndsdate], [fndspmt], [fndsbranch], [fndscomment], [fndsclearedbank]) VALUES (102, 5002, CAST(N'2019-10-02' AS Date), CAST(250.50 AS Money), N'Trenton', NULL, 0)
INSERT [dbo].[tblfundsrcvd] ([fndsid], [fndscaseid], [fndsdate], [fndspmt], [fndsbranch], [fndscomment], [fndsclearedbank]) VALUES (103, 5010, CAST(N'2020-12-15' AS Date), CAST(0.00 AS Money), N'Camden', N'write-off', 0)
SET IDENTITY_INSERT [dbo].[tblfundsrcvd] OFF
GO
SET IDENTITY_INSERT [dbo].[tblsrvauth] ON
INSERT [dbo].[tblsrvauth] ([srvauthid], [srvauthcaseid], [srvauthdate], [srvauthhours], [srvauthstatus], [srvadvance], [srvauthnotes]) VALUES (111, 5001, CAST(N'2019-02-05' AS Date), CAST(10.00 AS Decimal(8, 2)), N'Approved', CAST(1000.00 AS Money), N'signed')
INSERT [dbo].[tblsrvauth] ([srvauthid], [srvauthcaseid], [srvauthdate], [srvauthhours], [srvauthstatus], [srvadvance], [srvauthnotes]) VALUES (112, 5002, CAST(N'2019-05-25' AS Date), CAST(5.50 AS Decimal(8, 2)), N'Pending', NULL, NULL)
INSERT [dbo].[tblsrvauth] ([srvauthid], [srvauthcaseid], [srvauthdate], [srvauthhours], [srvauthstatus], [srvadvance], [srvauthnotes]) VALUES (113, 5010, CAST(N'2020-08-20' AS Date), CAST(0.25 AS Decimal(8, 2)), N'Draft', NULL, N'')
SET IDENTITY_INSERT [dbo].[tblsrvauth] OFF
GO
SET IDENTITY_INSERT [dbo].[tblcaseresult] ON
INSERT [dbo].[tblcaseresult] ([rsltid], [rsltcaseid], [rsltdate], [rslttype], [rsltsatisfaction]) VALUES (121, 5001, CAST(N'2021-01-04' AS Date), N'Settled', N'High')
INSERT [dbo].[tblcaseresult] ([rsltid], [rsltcaseid], [rsltdate], [rslttype], [rsltsatisfaction]) VALUES (122, 5002, NULL, N'Verdict', NULL)
INSERT [dbo].[tblcaseresult] ([rsltid], [rsltcaseid], [rsltdate], [rslttype], [rsltsatisfaction]) VALUES (123, 5010, CAST(N'2021-03-30' AS Date), NULL, N'Low')
SET IDENTITY_INSERT [dbo].[tblcaseresult] OFF
GO
SET IDENTITY_INSERT [dbo].[tbl_scannedbillandcheck] ON
INSERT [dbo].[tbl_scannedbillandcheck] ([id_number], [check_number], [check_date], [description], [long_description], [scan_filename]) VALUES (131, 1001, CAST(N'2019-03-02' AS Date), N'check 1001', N'scan of check 1001', N'chk1001.pdf')
INSERT [dbo].[tbl_scannedbillandcheck] ([id_number], [check_number], [check_date], [description], [long_description], [scan_filename]) VALUES (132, 1002, NULL, N'check 1002', NULL, N'chk1002.pdf')
INSERT [dbo].[tbl_scannedbillandcheck] ([id_number], [check_number], [check_date], [description], [long_description], [scan_filename]) VALUES (133, NULL, NULL, NULL, NULL, NULL)
SET IDENTITY_INSERT [dbo].[tbl_scannedbillandcheck] OFF
GO
SET IDENTITY_INSERT [dbo].[tblscanneddocument] ON
INSERT [dbo].[tblscanneddocument] ([id], [caseid], [expenseid], [incomeid], [inquiryid], [dateadded], [type], [description], [filename], [billid], [servauthid]) VALUES (141, 5001, 91, 101, 61, CAST(N'2019-03-06' AS Date), N'Bill', N'bill scan', N'b71.pdf', 71, 111)
INSERT [dbo].[tblscanneddocument] ([id], [caseid], [expenseid], [incomeid], [inquiryid], [dateadded], [type], [description], [filename], [billid], [servauthid]) VALUES (142, 5002, NULL, NULL, NULL, NULL, N'Report', NULL, N'r1.pdf', NULL, NULL)
INSERT [dbo].[tblscanneddocument] ([id], [caseid], [expenseid], [incomeid], [inquiryid], [dateadded], [type], [description], [filename], [billid], [servauthid]) VALUES (143, 5010, 93, 103, 63, CAST(N'2021-01-02' AS Date), N'Misc', N'misc scan', NULL, 73, 113)
SET IDENTITY_INSERT [dbo].[tblscanneddocument] OFF
GO
